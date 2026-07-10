import { db } from '@/lib/db/client';
import { orders, orderParties, contacts, companies, vendorApiLogs } from '@/lib/db/schema';
import { eq, and, isNull, or, sql } from 'drizzle-orm';
import { getOrderContacts, mapOrderContacts } from '@/lib/integrations/softpro';
import type { MappedOrderContacts, MappedResolvedParty } from '@/lib/integrations/softpro';
import type { SoftProOrderContactsData } from '@/lib/integrations/softpro/types';
import { resolveClientContactId } from '@/lib/domain/orders/client-resolver';

// ─── Types ───────────────────────────────────────────────────────────────────

export type EnrichOutcome = 'parties_written' | 'empty_confirmed' | 'fk_only' | 'failed';

export interface EnrichOrdersResult {
  total: number;
  attempted: number;
  partiesWritten: number;
  fkOnly: number;
  emptyConfirmed: number;
  failed: number;
  errors: Array<{ fileNumber: string; error: string }>;
}

export interface EnrichSingleResult {
  success: boolean;
  orderId: number;
  fileNumber: string;
  resolved: Record<string, number | null>;
  unresolved: string[];
  partiesWritten: number;
  contactsEmptyConfirmed: boolean;
  outcome: EnrichOutcome;
  error?: string;
}

interface OrderFkUpdates {
  lenderId: number | null;
  listingAgentId: number | null;
  titleCompanyId: number | null;
  underwriterId: number | null;
  clientContactId: number | null;
}

interface ResolvedPartyIdentity {
  name: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  contactId: number | null;
}

// ─── Single Order Enrichment ─────────────────────────────────────────────────

export async function enrichSingleOrder(orderId: number): Promise<EnrichSingleResult> {
  const [order] = await db.select({ id: orders.id, fileNumber: orders.fileNumber, orderType: orders.orderType })
    .from(orders).where(eq(orders.id, orderId)).limit(1);

  if (!order) {
    return {
      success: false,
      orderId,
      fileNumber: '',
      resolved: {},
      unresolved: [],
      partiesWritten: 0,
      contactsEmptyConfirmed: false,
      outcome: 'failed',
      error: 'Order not found',
    };
  }

  return enrichOrder(order);
}

async function enrichOrder(order: { id: number; fileNumber: string; orderType: string | null }): Promise<EnrichSingleResult> {
  const result: EnrichSingleResult = {
    success: false,
    orderId: order.id,
    fileNumber: order.fileNumber,
    resolved: {},
    unresolved: [],
    partiesWritten: 0,
    contactsEmptyConfirmed: false,
    outcome: 'failed',
  };

  const startedAt = new Date();

  const apiResult = await getOrderContacts(order.fileNumber);
  if (!apiResult.success || !apiResult.data) {
    result.error = apiResult.error?.message ?? 'GetOrderContacts returned no data';
    await logEnrichAttempt(order.id, order.fileNumber, startedAt, result);
    return result;
  }

  const data = apiResult.data;
  const mapped = mapOrderContacts(data);
  const updates: OrderFkUpdates = {
    lenderId: null,
    listingAgentId: null,
    titleCompanyId: null,
    underwriterId: null,
    clientContactId: null,
  };

  const lenderCode = mapped.lenderCode;
  if (lenderCode || mapped.parties.lender?.name) {
    const id = await ensureContactFromResolved(mapped.parties.lender, { isLender: true })
      ?? (lenderCode ? await resolveContact(lenderCode) : null);
    updates.lenderId = id;
    if (id) {
      result.resolved.lenderId = id;
      await refreshContactFromResolved(id, mapped.parties.lender);
    }
    else result.unresolved.push(`Lenders.PersonLookupCode=${lenderCode}`);
  }

  const listingCode = mapped.listingAgentPersonCode;
  if (listingCode || mapped.parties.listingAgent?.name) {
    const id = await ensureContactFromResolved(mapped.parties.listingAgent, { isRealEstateAgent: true })
      ?? (listingCode ? await resolveContact(listingCode) : null);
    updates.listingAgentId = id;
    if (id) {
      result.resolved.listingAgentId = id;
      await refreshContactFromResolved(id, mapped.parties.listingAgent);
      await flagRealEstateAgentAndCompany(id);
    } else result.unresolved.push(`ListingAgentBrokers.PersonLookupCode=${listingCode}`);
  }

  const titleCompanyCode = mapped.titleCompanyCode;
  if (titleCompanyCode || mapped.parties.titleCompany?.companyName) {
    const id = await ensureCompanyFromResolved(mapped.parties.titleCompany)
      ?? (titleCompanyCode ? await resolveCompany(titleCompanyCode) : null);
    updates.titleCompanyId = id;
    if (id) {
      result.resolved.titleCompanyId = id;
      await refreshCompanyFromResolved(id, mapped.parties.titleCompany);
    }
    else result.unresolved.push(`TitleCompanies.CompanyLookUpCode=${titleCompanyCode}`);
  }

  const underwriterCode = mapped.underwriterCompanyCode;
  if (underwriterCode || mapped.parties.underwriter?.companyName) {
    const id = await ensureCompanyFromResolved(mapped.parties.underwriter, { isUnderwriter: true })
      ?? (underwriterCode ? await resolveCompany(underwriterCode) : null);
    updates.underwriterId = id;
    if (id) {
      result.resolved.underwriterId = id;
      await refreshCompanyFromResolved(id, mapped.parties.underwriter);
    }
    else result.unresolved.push(`Underwriters.CompanyLookUpCode=${underwriterCode}`);
  }

  const clientContactId = await resolveClientContactId(order.orderType, data);
  if (clientContactId) {
    updates.clientContactId = clientContactId;
    result.resolved.clientContactId = clientContactId;
  }

  const setFields: Record<string, unknown> = { updatedAt: new Date() };
  let hasUpdate = false;
  for (const [key, val] of Object.entries(updates)) {
    if (val !== null) {
      setFields[key] = val;
      hasUpdate = true;
    }
  }

  const contactsEmptyConfirmed = softProContactsEmpty(data, mapped);
  result.contactsEmptyConfirmed = contactsEmptyConfirmed;
  setFields.contactsEmptyConfirmed = contactsEmptyConfirmed;

  if (hasUpdate || contactsEmptyConfirmed) {
    await db.update(orders).set(setFields).where(eq(orders.id, order.id));
  }

  result.partiesWritten = await persistResolvedParties(order.id, mapped, updates);

  if (result.partiesWritten > 0) {
    result.outcome = 'parties_written';
    result.success = true;
    await db.update(orders)
      .set({ contactsEmptyConfirmed: false, updatedAt: new Date() })
      .where(eq(orders.id, order.id));
    result.contactsEmptyConfirmed = false;
  } else if (contactsEmptyConfirmed) {
    result.outcome = 'empty_confirmed';
    result.success = true;
  } else if (Object.keys(result.resolved).length > 0) {
    result.outcome = 'fk_only';
    result.success = false;
  } else {
    result.outcome = 'failed';
    result.success = false;
  }

  await logEnrichAttempt(order.id, order.fileNumber, startedAt, result);
  return result;
}

// ─── Batch Enrichment ────────────────────────────────────────────────────────

export async function handleEnrichOrders(): Promise<EnrichOrdersResult> {
  const unenriched = await db
    .select({ id: orders.id, fileNumber: orders.fileNumber, orderType: orders.orderType })
    .from(orders)
    .where(
      and(
        or(
          isNull(orders.contactsEmptyConfirmed),
          eq(orders.contactsEmptyConfirmed, false),
        ),
        or(
          and(
            isNull(orders.lenderId),
            isNull(orders.listingAgentId),
            isNull(orders.titleCompanyId),
            isNull(orders.underwriterId),
          ),
          isNull(orders.clientContactId),
          sql`NOT EXISTS (SELECT 1 FROM ${orderParties} op WHERE op.order_id = ${orders.id})`,
        ),
        or(
          isNull(orders.lastContactsFetchAt),
          sql`${orders.lastContactsFetchAt} < NOW() - INTERVAL '6 hours'`,
        ),
      )
    )
    .orderBy(sql`${orders.lastContactsFetchAt} ASC NULLS FIRST`)
    .limit(200);

  const stats: EnrichOrdersResult = {
    total: unenriched.length,
    attempted: 0,
    partiesWritten: 0,
    fkOnly: 0,
    emptyConfirmed: 0,
    failed: 0,
    errors: [],
  };

  for (const order of unenriched) {
    try {
      await db.update(orders)
        .set({ lastContactsFetchAt: sql`NOW()` })
        .where(eq(orders.id, order.id));

      stats.attempted++;
      const result = await enrichOrder(order);

      switch (result.outcome) {
        case 'parties_written':
          stats.partiesWritten++;
          break;
        case 'empty_confirmed':
          stats.emptyConfirmed++;
          break;
        case 'fk_only':
          stats.fkOnly++;
          break;
        case 'failed':
          stats.failed++;
          if (result.error) {
            stats.errors.push({ fileNumber: order.fileNumber, error: result.error });
          }
          break;
      }
    } catch (err) {
      stats.failed++;
      stats.errors.push({
        fileNumber: order.fileNumber,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  return stats;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function softProContactsEmpty(data: SoftProOrderContactsData, mapped: MappedOrderContacts): boolean {
  const hasParty = Object.values(mapped.parties).some((party) => party !== null);
  const hasLookupCode = [
    mapped.escrowCompanyCode,
    mapped.escrowPersonCode,
    mapped.lenderCompanyCode,
    mapped.lenderCode,
    mapped.listingAgentCompanyCode,
    mapped.listingAgentPersonCode,
    mapped.mortgageBrokerCode,
    mapped.payoffLenderCode,
    mapped.titleCompanyCode,
    mapped.underwriterCompanyCode,
    mapped.underwriterPersonCode,
  ].some((code) => code !== null);
  const hasBorrowerSeller = [
    mapped.primaryBuyer,
    mapped.secondaryBuyer,
    mapped.primarySeller,
    mapped.secondarySeller,
  ].some((name) => name !== null);

  if (hasParty || hasLookupCode || hasBorrowerSeller) return false;

  return softProValueEmpty(data);
}

function softProValueEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.every(softProValueEmpty);
  if (typeof value === 'object') return Object.values(value).every(softProValueEmpty);
  return false;
}

async function logEnrichAttempt(
  orderId: number,
  fileNumber: string,
  startedAt: Date,
  result: EnrichSingleResult,
): Promise<void> {
  try {
    await db.insert(vendorApiLogs).values({
      vendor: 'softpro',
      operation: 'enrich_order_contacts',
      orderId,
      requestId: crypto.randomUUID(),
      startedAt,
      endedAt: new Date(),
      success: result.outcome !== 'failed',
      requestMeta: {
        fileNumber,
        outcome: result.outcome,
        partiesWritten: result.partiesWritten,
        contactsEmptyConfirmed: result.contactsEmptyConfirmed,
        fkResolved: Object.keys(result.resolved),
        unresolved: result.unresolved,
        error: result.error ?? null,
      } as Record<string, unknown>,
    });
  } catch {
    /* logging must not break enrichment */
  }
}

async function resolveContact(lookupCode: string): Promise<number | null> {
  const [row] = await db.select({ id: contacts.id })
    .from(contacts)
    .where(or(
      eq(contacts.lookupCode, lookupCode),
      eq(contacts.softproLookupCode, lookupCode),
      eq(contacts.sourceId, lookupCode),
    ))
    .limit(1);
  return row?.id ?? null;
}

async function loadContactIdentity(contactId: number): Promise<ResolvedPartyIdentity> {
  const [row] = await db.select({
    id: contacts.id,
    fullName: contacts.fullName,
    email: contacts.email,
    phone: contacts.phone,
    companyName: contacts.companyName,
  })
    .from(contacts)
    .where(eq(contacts.id, contactId))
    .limit(1);

  if (!row) {
    return { name: null, company: null, email: null, phone: null, contactId: null };
  }

  return {
    name: row.fullName,
    company: row.companyName,
    email: row.email,
    phone: row.phone,
    contactId: row.id,
  };
}

async function loadCompanyIdentity(companyId: number): Promise<ResolvedPartyIdentity> {
  const [row] = await db.select({
    name: companies.name,
    email: companies.email,
    phone: companies.phone,
  })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);

  if (!row) {
    return { name: null, company: null, email: null, phone: null, contactId: null };
  }

  return {
    name: null,
    company: row.name,
    email: row.email,
    phone: row.phone,
    contactId: null,
  };
}

async function resolvePartyIdentityFromMaster(
  party: MappedResolvedParty,
  fkContactId?: number | null,
  fkCompanyId?: number | null,
): Promise<ResolvedPartyIdentity> {
  let identity: ResolvedPartyIdentity = {
    name: party.name,
    company: party.companyName,
    email: party.email ?? party.companyEmail,
    phone: party.phone ?? party.companyPhone,
    contactId: null,
  };

  if (party.lookupCode) {
    const [contact] = await db.select({
      id: contacts.id,
      fullName: contacts.fullName,
      email: contacts.email,
      phone: contacts.phone,
      companyName: contacts.companyName,
    })
      .from(contacts)
      .where(or(
        eq(contacts.lookupCode, party.lookupCode),
        eq(contacts.softproLookupCode, party.lookupCode),
        eq(contacts.sourceId, party.lookupCode),
      ))
      .limit(1);

    if (contact) {
      identity = {
        name: identity.name ?? contact.fullName,
        company: identity.company ?? contact.companyName,
        email: identity.email ?? contact.email,
        phone: identity.phone ?? contact.phone,
        contactId: contact.id,
      };
    }
  }

  if (party.companyLookupCode) {
    const [company] = await db.select({
      name: companies.name,
      email: companies.email,
      phone: companies.phone,
    })
      .from(companies)
      .where(or(
        eq(companies.lookupCode, party.companyLookupCode),
        eq(companies.sourceId, party.companyLookupCode),
      ))
      .limit(1);

    if (company) {
      identity = {
        name: identity.name,
        company: identity.company ?? company.name,
        email: identity.email ?? company.email,
        phone: identity.phone ?? company.phone,
        contactId: identity.contactId,
      };
    }
  }

  if (fkContactId) {
    const fkIdentity = await loadContactIdentity(fkContactId);
    identity = {
      name: identity.name ?? fkIdentity.name,
      company: identity.company ?? fkIdentity.company,
      email: identity.email ?? fkIdentity.email,
      phone: identity.phone ?? fkIdentity.phone,
      contactId: identity.contactId ?? fkIdentity.contactId,
    };
  }

  if (fkCompanyId) {
    const fkIdentity = await loadCompanyIdentity(fkCompanyId);
    identity = {
      name: identity.name ?? fkIdentity.name,
      company: identity.company ?? fkIdentity.company,
      email: identity.email ?? fkIdentity.email,
      phone: identity.phone ?? fkIdentity.phone,
      contactId: identity.contactId,
    };
  }

  return identity;
}

async function flagRealEstateAgentAndCompany(contactId: number): Promise<void> {
  await db.update(contacts)
    .set({ isRealEstateAgent: true, updatedAt: new Date() })
    .where(and(
      eq(contacts.id, contactId),
      eq(contacts.isRealEstateAgent, false),
    ));

  const [agent] = await db.select({ flookupCode: contacts.flookupCode })
    .from(contacts)
    .where(eq(contacts.id, contactId))
    .limit(1);

  if (!agent?.flookupCode) return;

  await db.update(companies)
    .set({ isRealEstateCompany: true, updatedAt: new Date() })
    .where(and(
      eq(companies.lookupCode, agent.flookupCode),
      eq(companies.isRealEstateCompany, false),
    ));
}

async function resolveCompany(lookupCode: string): Promise<number | null> {
  const [row] = await db.select({ id: companies.id })
    .from(companies)
    .where(or(
      eq(companies.lookupCode, lookupCode),
      eq(companies.sourceId, lookupCode),
    ))
    .limit(1);
  return row?.id ?? null;
}

async function refreshContactFromResolved(contactId: number, party: MappedResolvedParty | null): Promise<void> {
  if (!party) return;

  const update: Partial<typeof contacts.$inferInsert> = { updatedAt: new Date() };
  if (party.name) update.fullName = party.name;
  if (party.email) update.email = party.email;
  if (party.phone) update.phone = party.phone;
  if (party.companyName) update.companyName = party.companyName;
  if (party.companyLookupCode) update.flookupCode = party.companyLookupCode;
  if (party.lookupCode) update.lookupCode = party.lookupCode;

  if (Object.keys(update).length === 1) return;
  await db.update(contacts).set(update).where(eq(contacts.id, contactId));
}

async function ensureContactFromResolved(
  party: MappedResolvedParty | null,
  flags: Partial<Pick<typeof contacts.$inferInsert, 'isLender' | 'isRealEstateAgent'>> = {},
): Promise<number | null> {
  if (!party) return null;
  const lookup = party.lookupCode;
  const name = party.name;

  const existingId = lookup ? await resolveContact(lookup) : null;
  if (existingId) return existingId;
  if (!lookup || !name) return null;

  const [inserted] = await db.insert(contacts).values({
    sourceSystem: 'softpro',
    sourceId: lookup,
    lookupCode: lookup,
    softproLookupCode: lookup,
    fullName: name,
    email: party.email,
    phone: party.phone,
    companyName: party.companyName,
    flookupCode: party.companyLookupCode,
    ...flags,
  }).returning({ id: contacts.id });

  return inserted?.id ?? null;
}

async function refreshCompanyFromResolved(companyId: number, party: MappedResolvedParty | null): Promise<void> {
  if (!party) return;

  const update: Partial<typeof companies.$inferInsert> = { updatedAt: new Date() };
  if (party.companyName) update.name = party.companyName;
  if (party.companyEmail) update.email = party.companyEmail;
  if (party.companyPhone) update.phone = party.companyPhone;
  if (party.companyLookupCode) update.lookupCode = party.companyLookupCode;

  if (Object.keys(update).length === 1) return;
  await db.update(companies).set(update).where(eq(companies.id, companyId));
}

async function ensureCompanyFromResolved(
  party: MappedResolvedParty | null,
  flags: Partial<Pick<typeof companies.$inferInsert, 'isEscrowCompany' | 'isUnderwriter'>> = {},
): Promise<number | null> {
  if (!party) return null;
  const lookup = party.companyLookupCode;
  const name = party.companyName;

  const existingId = lookup ? await resolveCompany(lookup) : null;
  if (existingId) return existingId;
  if (!lookup) return null;

  const [inserted] = await db.insert(companies).values({
    sourceSystem: 'softpro',
    sourceId: lookup,
    lookupCode: lookup,
    name: name ?? lookup,
    email: party.companyEmail,
    phone: party.companyPhone,
    ...flags,
  }).returning({ id: companies.id });

  return inserted?.id ?? null;
}

type PartyRole = typeof orderParties.role.enumValues[number];

interface PartyUpsert {
  role: PartyRole;
  isPrimary: boolean;
  party: MappedResolvedParty | null;
  contactId?: number | null;
  companyId?: number | null;
}

async function persistResolvedParties(
  orderId: number,
  mapped: MappedOrderContacts,
  updates: OrderFkUpdates,
): Promise<number> {
  const rows: PartyUpsert[] = [
    { role: 'buyer', isPrimary: true, party: mapped.parties.buyer },
    { role: 'buyer', isPrimary: false, party: mapped.parties.secondaryBuyer },
    { role: 'seller', isPrimary: true, party: mapped.parties.seller },
    { role: 'seller', isPrimary: false, party: mapped.parties.secondarySeller },
    { role: 'lender', isPrimary: true, party: mapped.parties.lender, contactId: updates.lenderId },
    { role: 'listing_agent', isPrimary: true, party: mapped.parties.listingAgent, contactId: updates.listingAgentId },
    { role: 'escrow_company', isPrimary: true, party: mapped.parties.escrowCompany },
    { role: 'lender_contact', isPrimary: true, party: mapped.parties.mortgageBroker },
    { role: 'other', isPrimary: true, party: mapped.parties.titleCompany, companyId: updates.titleCompanyId },
    { role: 'other', isPrimary: false, party: mapped.parties.underwriter, companyId: updates.underwriterId },
  ];

  let written = 0;
  for (const row of rows) {
    if (!row.party && !row.contactId && !row.companyId) continue;
    if (await upsertResolvedParty(orderId, row)) written++;
  }
  return written;
}

async function upsertResolvedParty(orderId: number, row: PartyUpsert): Promise<boolean> {
  if (!row.party && !row.contactId && !row.companyId) return false;

  const identity = row.party
    ? await resolvePartyIdentityFromMaster(row.party, row.contactId, row.companyId)
    : await (async (): Promise<ResolvedPartyIdentity> => {
      if (row.contactId) return loadContactIdentity(row.contactId);
      if (row.companyId) return loadCompanyIdentity(row.companyId);
      return { name: null, company: null, email: null, phone: null, contactId: null };
    })();

  const externalName = identity.name;
  const externalCompany = identity.company;
  const externalEmail = identity.email;
  const externalPhone = identity.phone;

  if (!externalName && !externalCompany && !externalEmail && !externalPhone) return false;

  const contactId = identity.contactId ?? row.contactId ?? null;

  const [existing] = await db
    .select({ id: orderParties.id })
    .from(orderParties)
    .where(and(
      eq(orderParties.orderId, orderId),
      eq(orderParties.role, row.role),
      eq(orderParties.isPrimary, row.isPrimary),
    ))
    .limit(1);

  const values: Partial<typeof orderParties.$inferInsert> = {
    ...(contactId ? { contactId } : {}),
    ...(externalName ? { externalName } : {}),
    ...(externalCompany ? { externalCompany } : {}),
    ...(externalEmail ? { externalEmail } : {}),
    ...(externalPhone ? { externalPhone } : {}),
  };

  if (existing) {
    await db.update(orderParties).set(values).where(eq(orderParties.id, existing.id));
  } else {
    await db.insert(orderParties).values({
      orderId,
      role: row.role,
      isPrimary: row.isPrimary,
      contactId: contactId ?? null,
      externalName: externalName ?? null,
      externalCompany: externalCompany ?? null,
      externalEmail: externalEmail ?? null,
      externalPhone: externalPhone ?? null,
    });
  }

  return true;
}
