import { db } from '@/lib/db/client';
import { orders, orderParties, contacts, companies } from '@/lib/db/schema';
import { eq, and, isNull, or, sql } from 'drizzle-orm';
import { getOrderContacts, mapOrderContacts } from '@/lib/integrations/softpro';
import type { MappedOrderContacts, MappedResolvedParty } from '@/lib/integrations/softpro';
import { resolveClientContactId } from '@/lib/domain/orders/client-resolver';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface EnrichOrdersResult {
  total: number;
  enriched: number;
  skipped: number;
  errors: Array<{ fileNumber: string; error: string }>;
}

export interface EnrichSingleResult {
  success: boolean;
  orderId: number;
  fileNumber: string;
  resolved: Record<string, number | null>;
  unresolved: string[];
  error?: string;
}

// ─── Single Order Enrichment ─────────────────────────────────────────────────

export async function enrichSingleOrder(orderId: number): Promise<EnrichSingleResult> {
  const [order] = await db.select({ id: orders.id, fileNumber: orders.fileNumber, orderType: orders.orderType })
    .from(orders).where(eq(orders.id, orderId)).limit(1);

  if (!order) {
    return { success: false, orderId, fileNumber: '', resolved: {}, unresolved: [], error: 'Order not found' };
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
  };

  const apiResult = await getOrderContacts(order.fileNumber);
  if (!apiResult.success || !apiResult.data) {
    result.error = apiResult.error?.message ?? 'GetOrderContacts returned no data';
    return result;
  }

  const data = apiResult.data;
  const mapped = mapOrderContacts(data);
  const updates: Record<string, number | null> = {};

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

  if (hasUpdate) {
    await db.update(orders).set(setFields).where(eq(orders.id, order.id));
  }

  await persistResolvedParties(order.id, mapped);

  result.success = true;
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
          and(
            isNull(orders.lenderId),
            isNull(orders.listingAgentId),
            isNull(orders.titleCompanyId),
            isNull(orders.underwriterId),
          ),
          isNull(orders.clientContactId),
        ),
        or(
          isNull(orders.lastContactsFetchAt),
          sql`${orders.lastContactsFetchAt} < NOW() - INTERVAL '6 hours'`,
        ),
      )
    )
    .orderBy(sql`${orders.lastContactsFetchAt} ASC NULLS FIRST`)
    .limit(200);

  let enriched = 0;
  let skipped = 0;
  const errors: EnrichOrdersResult['errors'] = [];

  for (const order of unenriched) {
    try {
      await db.update(orders)
        .set({ lastContactsFetchAt: sql`NOW()` })
        .where(eq(orders.id, order.id));

      const result = await enrichOrder(order);
      if (result.success && Object.keys(result.resolved).length > 0) {
        enriched++;
      } else {
        skipped++;
      }
    } catch (err) {
      errors.push({
        fileNumber: order.fileNumber,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  return { total: unenriched.length, enriched, skipped, errors };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
}

async function persistResolvedParties(orderId: number, mapped: MappedOrderContacts): Promise<void> {
  const rows: PartyUpsert[] = [
    { role: 'buyer', isPrimary: true, party: mapped.parties.buyer },
    { role: 'buyer', isPrimary: false, party: mapped.parties.secondaryBuyer },
    { role: 'seller', isPrimary: true, party: mapped.parties.seller },
    { role: 'seller', isPrimary: false, party: mapped.parties.secondarySeller },
    { role: 'lender', isPrimary: true, party: mapped.parties.lender },
    { role: 'listing_agent', isPrimary: true, party: mapped.parties.listingAgent },
    { role: 'escrow_company', isPrimary: true, party: mapped.parties.escrowCompany },
    { role: 'lender_contact', isPrimary: true, party: mapped.parties.mortgageBroker },
  ];

  for (const row of rows) {
    if (!row.party) continue;
    await upsertResolvedParty(orderId, row);
  }
}

async function upsertResolvedParty(orderId: number, row: PartyUpsert): Promise<void> {
  const externalName = row.party?.name;
  const externalCompany = row.party?.companyName;
  const externalEmail = row.party?.email ?? row.party?.companyEmail;
  const externalPhone = row.party?.phone ?? row.party?.companyPhone;

  if (!externalName && !externalCompany && !externalEmail && !externalPhone) return;

  const contactId = row.contactId ?? (
    row.party?.lookupCode ? await resolveContact(row.party.lookupCode) : null
  );

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
}
