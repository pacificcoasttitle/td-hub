import { z } from 'zod';
import { db } from '@/lib/db/client';
import { orders, orderProperties, orderParties, orderStatusHistory, eventOutbox, companies } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { createOrder as softproCreateOrder } from '@/lib/integrations/softpro';
import { propertyLookup } from '@/lib/integrations/sitex/client';
import type { SiteXPropertyData } from '@/lib/integrations/sitex/types';
import { autoTriggerTitlePoint } from '@/lib/domain/titlepoint/auto-trigger';
import { linkSessionToOrder } from '@/lib/domain/titlepoint/pre-initiate';
import { getSetting } from '@/lib/domain/settings/service';
import { buildSoftProPayload } from './softpro-payload';

// ─── Zod Schema ─────────────────────────────────────────────────────────────

const contactSchema = z.object({
  companyLookupCode: z.string().optional(),
  clientLookupCode: z.string().optional(),
  name: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  companyName: z.string().optional(),
});

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
    isOrganization: z.boolean().default(false),
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
    branchCode: z.string().default('PCT'),
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
  deliverableEmails: z.array(z.string().email()).optional(),
  clientType: z.string().optional(),
  onBehalfOfContactId: z.number().int().positive().optional(),
  titlePointSessionId: z.string().optional(),
});

export type CreateOrderInput = z.infer<typeof createOrderInputSchema>;

export interface CreateOrderResult {
  success: boolean;
  orderId?: number;
  fileNumber?: string;
  error?: string;
}

// ─── Main Entry Point ───────────────────────────────────────────────────────

export async function createAndSendToSoftPro(raw: unknown, userId?: string): Promise<CreateOrderResult> {
  const parsed = createOrderInputSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: `Validation failed: ${parsed.error.message}` };
  }

  const input = parsed.data;
  let sitexData: SiteXPropertyData | null = null;

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

  const apn = input.property.apn ?? sitexData?.apn ?? '';
  const legal = input.property.legalDescription ?? sitexData?.legalDescription ?? '';
  const county = input.property.county ?? sitexData?.county ?? '';

  const uwCode = resolveUnderwriterCode(input.transaction.product);
  input.transaction.underwriterCode = uwCode;

  let underwriterId: number | null = null;
  try {
    const [uw] = await db.select({ id: companies.id }).from(companies)
      .where(and(eq(companies.lookupCode, uwCode), eq(companies.isUnderwriter, true)))
      .limit(1);
    if (uw) underwriterId = uw.id;
  } catch { /* underwriter lookup failure never blocks order creation */ }

  const softProPayload = buildSoftProPayload(input, { apn, legal, county });

  const spResult = await softproCreateOrder(softProPayload);
  if (!spResult.success || !spResult.data) {
    return { success: false, error: spResult.error?.message ?? 'SoftPro create order failed' };
  }

  const fileNumber = spResult.data.orderNumber;

  const { orderId } = await createLocalRecords(input, fileNumber, sitexData, { apn, legal, county }, userId, underwriterId);

  if (input.titlePointSessionId) {
    try {
      await linkSessionToOrder(input.titlePointSessionId, orderId, fileNumber);
    } catch { /* link failure never blocks order creation */ }
  } else if (input.property.address && input.property.state && county) {
    try {
      const tpResult = await autoTriggerTitlePoint(orderId, {
        address: input.property.address,
        city: input.property.city,
        state: input.property.state,
        county,
        apn: apn || null,
        fips: null,
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
  enriched: { apn: string; legal: string; county: string },
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
    openedAt: new Date(),
    source: 'manual_entry',
    isImported: false,
    softproLastSyncedAt: new Date(),
    createdBy: userId ?? null,
    underwriterId: underwriterId ?? null,
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
    fullAddress: [
      input.property.unitNumber
        ? `${input.property.address} ${input.property.unitNumber}`
        : input.property.address,
      input.property.city,
      input.property.state,
    ].filter(Boolean).join(', '),
  });

  const partyInserts = buildPartyInserts(orderId, input);
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

function contactParty(orderId: number, role: PartyInsert['role'], c: z.infer<typeof contactSchema>): PartyInsert {
  return { orderId, role, externalName: c.name ?? null, externalCompany: c.companyName ?? null, externalEmail: c.email ?? null, externalPhone: c.phone ?? null };
}

function buildPartyInserts(orderId: number, input: CreateOrderInput): PartyInsert[] {
  const p: PartyInsert[] = [
    { orderId, role: 'seller', isPrimary: true, externalName: [input.seller.firstName, input.seller.lastName].join(' ') },
    { orderId, role: 'buyer', isPrimary: true, externalName: [input.buyer.firstName, input.buyer.lastName].join(' ') },
  ];
  const c = input.contacts;
  if (c?.escrowCompany) p.push(contactParty(orderId, 'escrow_company', c.escrowCompany));
  if (c?.lender) p.push(contactParty(orderId, 'lender', c.lender));
  if (c?.buyerAgent) p.push(contactParty(orderId, 'buyer_agent', c.buyerAgent));
  if (c?.listingAgent) p.push(contactParty(orderId, 'listing_agent', c.listingAgent));
  return p;
}

function resolveUnderwriterCode(productType: string): string {
  return productType.toLowerCase().trim() === 'full alta' ? 'CW' : 'WC';
}
