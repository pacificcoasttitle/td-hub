import { z } from 'zod';
import { db } from '@/lib/db/client';
import { orders, orderProperties, orderParties, orderStatusHistory } from '@/lib/db/schema';
import { createOrder as softproCreateOrder } from '@/lib/integrations/softpro';
import { propertyLookup } from '@/lib/integrations/sitex/client';
import type { SiteXPropertyData } from '@/lib/integrations/sitex/types';
import { autoTriggerTitlePoint } from '@/lib/domain/titlepoint/auto-trigger';

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
  orderType: z.enum(['Title only', 'Title & Escrow', 'Escrow only']),
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

  const softProPayload = buildSoftProPayload(input, { apn, legal, county });

  const spResult = await softproCreateOrder(softProPayload);
  if (!spResult.success || !spResult.data) {
    return { success: false, error: spResult.error?.message ?? 'SoftPro create order failed' };
  }

  const fileNumber = spResult.data.orderNumber;

  const { orderId } = await createLocalRecords(input, fileNumber, sitexData, { apn, legal, county }, userId);

  if (input.property.address && input.property.state && county) {
    try {
      await autoTriggerTitlePoint(orderId, {
        address: input.property.address,
        city: input.property.city,
        state: input.property.state,
        county,
        apn: apn || null,
        fips: null,
      });
    } catch { /* TitlePoint failures never block order creation */ }
  }

  return { success: true, orderId, fileNumber };
}

// ─── Build SoftPro Payload ──────────────────────────────────────────────────

function buildSoftProPayload(
  input: CreateOrderInput,
  enriched: { apn: string; legal: string; county: string }
): Record<string, unknown> {
  const ec = input.contacts?.escrowCompany;

  return {
    baseDetails: {
      OrderType: input.orderType,
      ProjectName: 'PCT',
      IsRushOrder: input.isRushOrder,
    },
    personalDetails: {
      CompanyLookupCode: ec?.companyLookupCode ?? '',
      ClientLookupCode: ec?.clientLookupCode ?? '',
      UserType: 'EscrowCompany',
      CompanyName: ec?.companyName ?? '',
      Email: ec?.email ?? '',
      FirstName: ec?.name?.split(' ')[0] ?? '',
      LastName: ec?.name?.split(' ').slice(1).join(' ') ?? '',
      Telephone: ec?.phone ?? '',
      Address: '', City: '', ZipCode: '', State: '',
      EmailNotifications: true,
      SalesRep: input.transaction.titleOfficer ?? '',
    },
    propertyDetails: [{
      Address1: input.property.address,
      Address2: input.property.unitNumber ?? '',
      APNNumberParcelID: enriched.apn,
      Country: enriched.county,
      Description: enriched.legal,
      IsPrimaryResidence: true,
      City: input.property.city,
      Zip: input.property.zip.slice(0, 5),
      State: input.property.state,
      EscrowBriefLegalLookupCode: null,
      EscrowBriefLegal: enriched.legal,
    }],
    sellerDetails: {
      PrimaryOwnerFirstName: input.seller.firstName,
      PrimaryOwnerMiddleName: input.seller.middleName ?? '',
      PrimaryOwnerLastName: input.seller.lastName,
      SecondaryOwnerFirstName: input.seller.secondaryFirstName ?? '',
      SecondaryOwnerMiddleName: input.seller.secondaryMiddleName ?? '',
      SecondaryOwnerLastName: input.seller.secondaryLastName ?? '',
      OrganizationType: '',
      IsOrganization: String(input.seller.isOrganization),
    },
    transactionDetails: {
      LookUpCodeTitleOffice: input.transaction.branchCode,
      TitleOffice: input.transaction.titleOfficer ?? '',
      Product: input.transaction.product,
      EscrowNumber: input.transaction.escrowNumber ?? '',
      SalesAmount: input.transaction.salesAmount,
      TransactionType: input.transaction.type,
      LoanNumber: input.transaction.loanNumber ?? '',
      LoanAmount: input.transaction.loanAmount,
      UnderwriterLookUpCode: input.transaction.underwriterCode ?? '',
      CoverageAmount: input.transaction.coverageAmount,
      PrimaryBorrowerFirstName: input.buyer.firstName,
      PrimaryBorrowerMiddleName: input.buyer.middleName ?? '',
      PrimaryBorrowerLastName: input.buyer.lastName,
      SecondaryBorrowerFirstName: input.buyer.secondaryFirstName ?? '',
      SecondaryBorrowerMiddleName: input.buyer.secondaryMiddleName ?? '',
      SecondaryBorrowerLastName: input.buyer.secondaryLastName ?? '',
      IsOrganization: input.buyer.isOrganization,
      OrganizationType: input.buyer.organizationType ?? '',
    },
    buyersAgentDetails: mapContactSection(input.contacts?.buyerAgent),
    listingAgentDetails: mapContactSection(input.contacts?.listingAgent),
    escrowDetails: mapContactSection(input.contacts?.escrowCompany),
    lenderDetails: mapContactSection(input.contacts?.lender),
    mortgageDetails: mapContactSection(input.contacts?.mortgageBroker),
  };
}

function mapContactSection(c?: z.infer<typeof contactSchema>) {
  if (!c) return {};
  return {
    CompanyLookUpCode: c.companyLookupCode ?? '',
    ClientLookUpCode: c.clientLookupCode ?? '',
    Name: c.name ?? '',
    Email: c.email ?? '',
    Telephone: c.phone ?? '',
    CompanyName: c.companyName ?? '',
  };
}

// ─── Local Record Creation ──────────────────────────────────────────────────

async function createLocalRecords(
  input: CreateOrderInput,
  fileNumber: string,
  sitex: SiteXPropertyData | null,
  enriched: { apn: string; legal: string; county: string },
  userId?: string,
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

function buildPartyInserts(orderId: number, input: CreateOrderInput): PartyInsert[] {
  const parties: PartyInsert[] = [];
  parties.push({
    orderId, role: 'seller', isPrimary: true,
    externalName: [input.seller.firstName, input.seller.lastName].join(' '),
  });
  parties.push({
    orderId, role: 'buyer', isPrimary: true,
    externalName: [input.buyer.firstName, input.buyer.lastName].join(' '),
  });
  const c = input.contacts;
  if (c?.escrowCompany) parties.push({ orderId, role: 'escrow_company', externalName: c.escrowCompany.name ?? null, externalCompany: c.escrowCompany.companyName ?? null, externalEmail: c.escrowCompany.email ?? null, externalPhone: c.escrowCompany.phone ?? null });
  if (c?.lender) parties.push({ orderId, role: 'lender', externalName: c.lender.name ?? null, externalCompany: c.lender.companyName ?? null, externalEmail: c.lender.email ?? null, externalPhone: c.lender.phone ?? null });
  if (c?.buyerAgent) parties.push({ orderId, role: 'buyer_agent', externalName: c.buyerAgent.name ?? null, externalCompany: c.buyerAgent.companyName ?? null, externalEmail: c.buyerAgent.email ?? null, externalPhone: c.buyerAgent.phone ?? null });
  if (c?.listingAgent) parties.push({ orderId, role: 'listing_agent', externalName: c.listingAgent.name ?? null, externalCompany: c.listingAgent.companyName ?? null, externalEmail: c.listingAgent.email ?? null, externalPhone: c.listingAgent.phone ?? null });
  return parties;
}
