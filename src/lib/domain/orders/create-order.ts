import { z } from 'zod';
import { db } from '@/lib/db/client';
import { orders, orderProperties, orderParties, orderStatusHistory, eventOutbox, companies, contacts, branches } from '@/lib/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { createOrder as softproCreateOrder } from '@/lib/integrations/softpro';
import { propertyLookup } from '@/lib/integrations/sitex/client';
import type { SiteXPropertyData } from '@/lib/integrations/sitex/types';
import { autoTriggerTitlePoint } from '@/lib/domain/titlepoint/auto-trigger';
import { linkSessionToOrder } from '@/lib/domain/titlepoint/pre-initiate';
import { initiateSearch } from '@/lib/domain/titlepoint/service';
import { getSetting } from '@/lib/domain/settings/service';
import { resolveCaliforniaFips } from '@/lib/integrations/titlepoint/fips';
import {
  assertKnownTitleOffice,
  buildSoftProPayload,
  SoftProPayloadError,
  type ResolvedContact,
  type ResolvedContacts,
} from './softpro-payload';

// ─── Zod Schema ─────────────────────────────────────────────────────────────

const contactSchema = z.object({
  companyLookupCode: z.string().optional(),
  clientLookupCode: z.string().optional(),
  name: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  companyName: z.string().optional(),
  /**
   * The contacts row behind a typeahead pick. Optional because a company pick
   * is the other half of this form, not an error — a company has a lookup code
   * but no contact row to link. Never trusted as given: it is looked up with
   * the officer ids and only a row that came back is written.
   */
  contactId: z.number().int().positive().optional(),
});

/** Every party the form collects through the shared contact component. */
const PARTY_KEYS = ['escrowCompany', 'lender', 'buyerAgent', 'listingAgent', 'mortgageBroker'] as const;

export const createOrderInputSchema = z.object({
  orderType: z.enum(['Title only', 'Title & Escrow', 'Escrow only', 'Sub Escrow', 'Title Search']),
  isRushOrder: z.boolean().default(false),
  property: z.object({
    address: z.string().min(1),
    city: z.string().min(1),
    state: z.string().default('CA'),
    zip: z.string().min(3),
    apn: z.string().optional(),
    legalDescription: z.string().optional(),
    county: z.string().optional(),
    unitNumber: z.string().optional(),
  }),
  seller: z.object({
    firstName: z.string().default('TBD'), middleName: z.string().optional(), lastName: z.string().default('TBD'),
    secondaryFirstName: z.string().optional(), secondaryMiddleName: z.string().optional(), secondaryLastName: z.string().optional(),
    isOrganization: z.boolean().default(false), organizationType: z.string().optional(),
  }).default({ firstName: 'TBD', lastName: 'TBD', isOrganization: false }),
  buyer: z.object({
    firstName: z.string().default('TBD'), middleName: z.string().optional(), lastName: z.string().default('TBD'),
    secondaryFirstName: z.string().optional(), secondaryMiddleName: z.string().optional(), secondaryLastName: z.string().optional(),
    isOrganization: z.boolean().default(false), organizationType: z.string().optional(),
  }).default({ firstName: 'TBD', lastName: 'TBD', isOrganization: false }),
  transaction: z.object({
    type: z.string().min(1),
    product: z.string().min(1),
    productTypeId: z.string().optional(),
    orderTypeId: z.string().optional(),
    escrowNumber: z.string().optional(),
    salesAmount: z.number().default(0),
    loanNumber: z.string().optional(),
    loanAmount: z.number().default(0),
    coverageAmount: z.number().default(0),
    salesRep: z.string().optional(),
    titleOfficer: z.string().optional(),
    escrowOfficer: z.string().optional(),
    underwriterCode: z.string().optional(),
  }),
  contacts: z.object({
    escrowCompany: contactSchema.optional(),
    lender: contactSchema.optional(),
    buyerAgent: contactSchema.optional(),
    listingAgent: contactSchema.optional(),
    mortgageBroker: contactSchema.optional(),
  }).optional(),
  clientType: z.string().optional(),
  onBehalfOfContactId: z.number().int().positive().optional(),
  titlePointSessionId: z.string().optional(),
  /**
   * Input-phase SiteX result (confident match). When present, skip the
   * duplicate SiteX lookup on submit.
   */
  siteXSnapshot: z.object({
    matchCode: z.literal('S').optional(),
    apn: z.string().nullable().optional(),
    legalDescription: z.string().nullable().optional(),
    county: z.string().nullable().optional(),
    fips: z.string().nullable().optional(),
    propertyType: z.string().nullable().optional(),
    primaryOwner: z.string().nullable().optional(),
    secondaryOwner: z.string().nullable().optional(),
  }).optional(),
});

export type CreateOrderInput = z.infer<typeof createOrderInputSchema>;

/**
 * Which route opened the order, written verbatim to `orders.source`.
 *
 * Required rather than defaulted: this function hardcoded 'manual_entry', so
 * the client wizard's orders were indistinguishable from an operator's and
 * 'web_form' had zero rows. A default would let a fourth caller inherit the
 * operator label the same silent way. `softpro_sync` is deliberately absent —
 * the sync job writes its own rows via upsertSoftProOrder.
 */
export type OrderOrigin = 'manual_entry' | 'web_form';

export interface CreateOrderResult {
  success: boolean;
  orderId?: number;
  fileNumber?: string;
  error?: string;
}

const SOFTPRO_CONFIG_ERROR_MESSAGE = 'Order could not be sent to SoftPro — service configuration error';

// ─── Main Entry Point ───────────────────────────────────────────────────────

export async function createAndSendToSoftPro(raw: unknown, origin: OrderOrigin, userId?: string): Promise<CreateOrderResult> {
  const parsed = createOrderInputSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: `Validation failed: ${parsed.error.message}` };
  }

  const input = parsed.data;
  let sitexData: SiteXPropertyData | null = null;

  // Prefer the input-phase SiteX snapshot — do not call SiteX again on submit.
  if (input.siteXSnapshot && (input.siteXSnapshot.matchCode === 'S' || input.siteXSnapshot.apn || input.siteXSnapshot.legalDescription)) {
    sitexData = {
      matchCode: 'S',
      apn: input.siteXSnapshot.apn ?? null,
      legalDescription: input.siteXSnapshot.legalDescription ?? null,
      county: input.siteXSnapshot.county ?? null,
      fips: input.siteXSnapshot.fips ?? null,
      propertyType: input.siteXSnapshot.propertyType ?? null,
      primaryOwner: input.siteXSnapshot.primaryOwner ?? null,
      secondaryOwner: input.siteXSnapshot.secondaryOwner ?? null,
      fullAddress: null,
      city: null,
      state: null,
      zip: null,
      unitNumber: null,
      beds: null,
      baths: null,
      sqft: null,
      lotSize: null,
      yearBuilt: null,
      assessedValue: null,
      lastSaleDate: null,
      lastSalePrice: null,
    };
  } else {
    try {
      const sxResult = await propertyLookup({
        street: input.property.address,
        city: input.property.city,
        state: input.property.state,
        zip: input.property.zip,
      });
      if (sxResult.success && sxResult.data?.matchCode === 'S') {
        sitexData = sxResult.data;
      }
    } catch { /* SiteX failure never blocks order creation */ }
  }

  const apn = input.property.apn ?? sitexData?.apn ?? '';
  const legal = input.property.legalDescription ?? sitexData?.legalDescription ?? '';
  const county = input.property.county ?? sitexData?.county ?? '';
  const fips = sitexData?.fips ?? resolveCaliforniaFips(county) ?? null;

  const uwCode = input.transaction.underwriterCode || resolveUnderwriterCode(input.transaction.product);
  input.transaction.underwriterCode = uwCode;

  let underwriterId: number | null = null;
  try {
    const [uw] = await db.select({ id: companies.id }).from(companies)
      .where(and(eq(companies.lookupCode, uwCode), eq(companies.isUnderwriter, true)))
      .limit(1);
    if (uw) underwriterId = uw.id;
  } catch { /* underwriter lookup failure never blocks order creation */ }

  const resolved = await resolveContactIds(input);

  let softProPayload: Record<string, unknown>;
  try {
    softProPayload = buildSoftProPayload(input, { apn, legal, county }, resolved);
    assertKnownTitleOffice(softProPayload, await loadKnownTitleOffices());
  } catch (err) {
    // The operator can act on these, so they must reach the form rather than
    // becoming a generic 500 in the route's catch-all.
    if (err instanceof SoftProPayloadError) return { success: false, error: err.message };
    throw err;
  }

  const spResult = await softproCreateOrder(softProPayload);
  if (!spResult.success || !spResult.data) {
    return {
      success: false,
      error: spResult.error?.code === 'AUTH'
        ? SOFTPRO_CONFIG_ERROR_MESSAGE
        : spResult.error?.message ?? 'SoftPro create order failed',
    };
  }

  const fileNumber = spResult.data.orderNumber;

  const { orderId } = await createLocalRecords(input, fileNumber, sitexData, { apn, legal, county, fips }, resolved, origin, userId, underwriterId);

  if (input.titlePointSessionId) {
    try {
      await linkSessionToOrder(input.titlePointSessionId, orderId, fileNumber);
    } catch { /* link failure never blocks order creation */ }

    // Geo is post-order only (not in pre-init Tax+LV). Fire geo after link.
    try {
      await initiateSearch(orderId, 'geo_address', 'system:auto');
    } catch { /* geo failure never blocks order creation */ }
  } else if (input.property.address && input.property.state && county) {
    try {
      const tpResult = await autoTriggerTitlePoint(orderId, {
        address: input.property.address,
        city: input.property.city,
        state: input.property.state,
        county,
        apn: apn || null,
        fips,
      });

      if (tpResult.skipped) {
        try {
          const emailEnabled = await getSetting('open_order_confirmation_enabled');
          if (emailEnabled !== 'false') {
            await db.insert(eventOutbox).values({
              eventType: 'order.confirmation',
              orderId,
              payload: { noDocuments: true } as Record<string, unknown>,
            });
          }
        } catch { /* outbox insert failure never blocks order creation */ }
      }
    } catch { /* TitlePoint failures never block order creation */ }
  }

  return { success: true, orderId, fileNumber };
}

// ─── Local Record Creation ──────────────────────────────────────────────────

async function createLocalRecords(
  input: CreateOrderInput,
  fileNumber: string,
  sitex: SiteXPropertyData | null,
  enriched: { apn: string; legal: string; county: string; fips: string | null },
  resolved: ResolvedContacts,
  origin: OrderOrigin,
  userId?: string,
  underwriterId?: number | null,
): Promise<{ orderId: number }> {
  const [newOrder] = await db.insert(orders).values({
    fileNumber,
    operationalStatus: 'open',
    softproStatus: 'open',
    transactionType: validTxType(input.transaction.type),
    productType: input.transaction.product,
    orderType: input.orderType,
    salesPrice: String(input.transaction.salesAmount) || null,
    // 0 means "not entered" on this form, and writing 0.00 would render as a
    // real amount downstream. Absent stays absent.
    loanAmount: input.transaction.loanAmount > 0 ? String(input.transaction.loanAmount) : null,
    loanNumber: input.transaction.loanNumber || null,
    escrowNumber: input.transaction.escrowNumber || null,
    openedAt: new Date(),
    source: origin,
    isImported: false,
    softproLastSyncedAt: new Date(),
    createdBy: userId ?? null,
    underwriterId: underwriterId ?? null,
    // Form "client" (on behalf of) — confirmation resolver reads this as the primary TO.
    clientContactId: input.onBehalfOfContactId ?? null,
    // Assignment FKs come from the SAME resolved rows the SoftPro payload was
    // built from, so the id is known to exist and the send cannot disagree with
    // the record. Previously only process-detail (the SoftPro read-back) ever
    // wrote these, and the confirmation email sends before that runs.
    salesRepId: resolved.salesRep?.id ?? null,
    titleOfficerId: resolved.titleOfficer?.id ?? null,
    escrowOfficerId: resolved.escrowOfficer?.id ?? null,
    // Same rule for the two transaction parties that have a column of their own.
    // Until now the only writer was the enrich-orders read-back, which skips
    // hub-created orders once they have a client and an underwriter — so on a
    // hub order these stayed NULL for good.
    lenderId: resolved.parties?.lender?.id ?? null,
    listingAgentId: resolved.parties?.listingAgent?.id ?? null,
  }).returning({ id: orders.id });

  const orderId = newOrder!.id;

  await db.insert(orderProperties).values({
    orderId,
    address: input.property.address,
    city: input.property.city,
    state: input.property.state,
    zip: input.property.zip.slice(0, 5),
    county: enriched.county || null,
    apn: enriched.apn || null,
    legalDescription: enriched.legal || null,
    propertyType: sitex?.propertyType ?? null,
    primaryOwner: sitex?.primaryOwner ?? null,
    secondaryOwner: sitex?.secondaryOwner ?? null,
    fips: enriched.fips,
    fullAddress: [
      input.property.unitNumber
        ? `${input.property.address} ${input.property.unitNumber}`
        : input.property.address,
      input.property.city,
      input.property.state,
    ].filter(Boolean).join(', '),
  });

  const partyInserts = buildPartyInserts(orderId, input, resolved);
  if (partyInserts.length > 0) {
    await db.insert(orderParties).values(partyInserts);
  }

  await db.insert(orderStatusHistory).values({
    orderId,
    status: 'open',
    source: 'manual',
    notes: `Order created and sent to SoftPro (${fileNumber})`,
  });

  return { orderId };
}

const VALID_TX = ['Purchase', 'Refinance', 'Equity', 'Other'] as const;
function validTxType(v: string) {
  return (VALID_TX as readonly string[]).includes(v) ? v as (typeof VALID_TX)[number] : null;
}

type PartyInsert = typeof orderParties.$inferInsert;

function contactParty(
  orderId: number,
  role: PartyInsert['role'],
  c: z.infer<typeof contactSchema>,
  contact?: ResolvedContact,
): PartyInsert {
  return {
    orderId,
    role,
    // The identity all four order_parties writers agree on is
    // (order_id, role, is_primary) — enrich-orders upsertResolvedParty,
    // verify-order-sync reconcileParties and the party wizard's
    // projectToOrderParties all look a party up by that triple, and all three
    // ask for is_primary = true on every role reachable from this form. The
    // column default is false, so leaving it out meant the read-back missed the
    // operator's row and INSERTED its own beside it: two rows for one party,
    // with the operator's contact_id stranded on the row nothing reads.
    //
    // That is not hypothetical. Orders 11, 27 and 42 each carry a lender_contact
    // row written 11 March holding a raw lookup code (`PatLeeLeeM`) at
    // is_primary = false, and a second one written 13 June with the resolved name
    // at is_primary = true, from exactly this mismatch between two writers.
    //
    // Every role contactParty is called for is single-instance — production has
    // one row per (order, role) for all of them — so true is correct for all of
    // them, and setting it here rather than per call site is what stops the next
    // role added to the form from reintroducing the same bug. The unique index
    // added in migration 0035 is the backstop.
    isPrimary: true,
    // Null on free text. The external_* columns carry the party either way, so a
    // typed party is still a party — it just has nothing to link to.
    contactId: contact?.id ?? null,
    externalName: c.name ?? null,
    externalCompany: c.companyName ?? null,
    externalEmail: c.email ?? null,
    externalPhone: c.phone ?? null,
  };
}

function buildPartyInserts(orderId: number, input: CreateOrderInput, resolved: ResolvedContacts): PartyInsert[] {
  const p: PartyInsert[] = [
    { orderId, role: 'seller', isPrimary: true, externalName: [input.seller.firstName, input.seller.lastName].join(' ') },
    { orderId, role: 'buyer', isPrimary: true, externalName: [input.buyer.firstName, input.buyer.lastName].join(' ') },
  ];
  const c = input.contacts;
  const r = resolved.parties;
  if (c?.escrowCompany) p.push(contactParty(orderId, 'escrow_company', c.escrowCompany, r?.escrowCompany));
  if (c?.lender) p.push(contactParty(orderId, 'lender', c.lender, r?.lender));
  if (c?.buyerAgent) p.push(contactParty(orderId, 'buyer_agent', c.buyerAgent, r?.buyerAgent));
  if (c?.listingAgent) p.push(contactParty(orderId, 'listing_agent', c.listingAgent, r?.listingAgent));
  // party_role has no mortgage_broker value, so this party had no row at all and
  // existed locally only inside the SoftPro payload. lender_contact is the role
  // the SoftPro read-back already files a mortgage broker under
  // (enrich-orders.ts persistResolvedParties), so using it here means the two
  // writers agree on one row instead of inventing an enum value.
  if (c?.mortgageBroker) p.push(contactParty(orderId, 'lender_contact', c.mortgageBroker, r?.mortgageBroker));
  return p;
}

function resolveUnderwriterCode(productType: string): string {
  return productType.toLowerCase().trim() === 'full alta' ? 'CW' : 'WC';
}

/**
 * Office codes for the pre-send title-office check, read from the synced
 * title-officer contacts rather than from SoftPro directly.
 *
 * getLookupTable('Title Officer') is the authority, but putting a live vendor
 * call in the create path would mean a SoftPro blip blocks every order — the
 * exact trade we are trying not to make. These rows are the same ones
 * syncTitleOfficers writes from that feed, and they are also where the code we
 * are about to send comes from, so a mismatch means the payload picked up an
 * office from somewhere other than a title officer. That is precisely the bug
 * this guards against: PRV was an escrow officer's branch and would not appear
 * here.
 *
 * Returning [] on any failure is deliberate — an unavailable check must not
 * refuse orders.
 */
async function loadKnownTitleOffices(): Promise<string[]> {
  try {
    const rows = await db
      .select({ office: contacts.officeLookupCode })
      .from(contacts)
      .where(eq(contacts.isTitleOfficer, true));
    return [...new Set(rows.map((r) => (r.office ?? '').trim().toUpperCase()).filter(Boolean))];
  } catch {
    return [];
  }
}

// ─── Contact Resolution ────────────────────────────────────────────────────

type ContactRow = typeof contacts.$inferSelect;

async function resolveContactIds(input: CreateOrderInput): Promise<ResolvedContacts> {
  const ids: number[] = [];
  const push = (v?: string | number) => {
    const n = Number(v);
    if (v && !isNaN(n)) ids.push(n);
  };
  push(input.transaction.salesRep);
  push(input.transaction.titleOfficer);
  push(input.transaction.escrowOfficer);
  push(input.onBehalfOfContactId);
  for (const key of PARTY_KEYS) push(input.contacts?.[key]?.contactId);

  if (ids.length === 0) return {};

  const rows = await db.select().from(contacts).where(inArray(contacts.id, ids));
  const byId = new Map<number, ContactRow>();
  for (const r of rows) byId.set(r.id, r);

  const get = (v?: string | number) => {
    const n = Number(v);
    return (!v || isNaN(n)) ? undefined : byId.get(n);
  };

  const result: ResolvedContacts = {
    salesRep: get(input.transaction.salesRep),
    titleOfficer: get(input.transaction.titleOfficer),
    escrowOfficer: get(input.transaction.escrowOfficer),
    opener: get(input.onBehalfOfContactId),
  };

  const parties: NonNullable<ResolvedContacts['parties']> = {};
  for (const key of PARTY_KEYS) {
    const row = get(input.contacts?.[key]?.contactId);
    if (row) parties[key] = row;
  }
  if (Object.keys(parties).length > 0) result.parties = parties;

  const openerRow = result.opener;
  if (openerRow?.flookupCode) {
    try {
      const [co] = await db.select({
        name: companies.name,
        lookupCode: companies.lookupCode,
        companyType: companies.companyType,
        isEscrowCompany: companies.isEscrowCompany,
        isLender: companies.isLender,
        isMortgageBroker: companies.isMortgageBroker,
        isRealEstateCompany: companies.isRealEstateCompany,
        branchId: companies.branchId,
      }).from(companies)
        .where(eq(companies.lookupCode, openerRow.flookupCode))
        .limit(1);

      if (co) {
        let branchCode: string | null = null;
        if (co.branchId) {
          const [b] = await db.select({ code: branches.code })
            .from(branches).where(eq(branches.id, co.branchId)).limit(1);
          branchCode = b?.code ?? null;
        }
        result.openerCompany = {
          name: co.name,
          lookupCode: co.lookupCode ?? '',
          companyType: co.companyType,
          isEscrowCompany: co.isEscrowCompany,
          isLender: co.isLender ?? false,
          isMortgageBroker: co.isMortgageBroker ?? false,
          isRealEstateCompany: co.isRealEstateCompany ?? false,
          branchCode,
        };
      }
    } catch { /* company resolution failure never blocks order creation */ }
  }

  return result;
}

