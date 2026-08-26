/**
 * READ-ONLY. Renders the SoftPro createOrder payload for two orders so the
 * before/after of the Title & Escrow branch-code fix can be diffed.
 *
 * Nothing is sent anywhere. Run it on this branch for the "after", and on a
 * worktree of origin/main for the "before" — same script, two code states, so
 * the diff is the code change and not a reimplementation of it.
 *
 *   npx tsx scripts/audit/te-payload-proof.ts
 */
import type { CreateOrderInput } from '@/lib/domain/orders/create-order';
import {
  buildSoftProPayload,
  type ResolvedContact,
  type ResolvedContacts,
} from '@/lib/domain/orders/softpro-payload';

function contact(overrides: Partial<ResolvedContact>): ResolvedContact {
  return {
    id: 0,
    fullName: null, firstName: null, lastName: null, email: null, phone: null,
    companyName: null, lookupCode: null, flookupCode: null, officeLookupCode: null,
    softproLookupCode: null, closerExaminer: null, officerName: null,
    softproUserType: null, userType: null,
    address1: null, city: null, state: null, zip: null,
    ...overrides,
  };
}

/** contacts.id 5 — from the Title Officer feed. */
const CLIVE_VIRATA = contact({
  id: 5,
  fullName: 'Clive Virata', firstName: 'Clive', lastName: 'Virata',
  officerName: 'Clive Virata', email: 'cvirata@pct.com',
  lookupCode: 'OCT', officeLookupCode: 'OCT',
  softproLookupCode: 'PCT\\cvirata', closerExaminer: 'PCT\\cvirata',
});

/** contacts.id 12 — from the Escrow Officer feed. PRV is an escrow branch. */
const ANNA_BALLESTEROS = contact({
  id: 12,
  fullName: 'Anna Ballesteros', firstName: 'Anna', lastName: 'Ballesteros',
  officerName: 'Anna Ballesteros', email: 'aballesteros@pct.com',
  lookupCode: 'AnnBalPaci', officeLookupCode: 'PRV',
  softproLookupCode: 'PCT\\aballesteros', closerExaminer: 'PCT\\aballesteros',
});

const ANDREW_WU = contact({
  id: 3001, fullName: 'Andrew Wu', officerName: 'Andrew Wu', lookupCode: 'AndWuPacif',
});

const OPENER = contact({
  id: 4001,
  fullName: 'Grace Yu', firstName: 'Grace', lastName: 'Yu',
  email: 'grace@atlasescrow.com', phone: '(626) 555-0134',
  companyName: 'Atlas Escrow', lookupCode: 'GraYuAtla', flookupCode: 'AtlEsc',
  address1: '500 N Brand Blvd', city: 'Glendale', state: 'CA', zip: '91203',
});

const RESOLVED: ResolvedContacts = {
  salesRep: ANDREW_WU,
  titleOfficer: CLIVE_VIRATA,
  escrowOfficer: ANNA_BALLESTEROS,
  opener: OPENER,
  openerCompany: {
    name: 'Atlas Escrow', lookupCode: 'AtlEsc', companyType: 'escrow_company',
    isEscrowCompany: true, isLender: false, isMortgageBroker: false,
    isRealEstateCompany: false, branchCode: null,
  },
};

const ENRICHED = { apn: '094-190-011', legal: 'Lot 7 of Tract 1234', county: 'TULARE' };

/** Order 1077788's shape: Title & Escrow with every party section filled in. */
const TITLE_AND_ESCROW: CreateOrderInput = {
  orderType: 'Title & Escrow',
  isRushOrder: false,
  property: {
    address: '1234 W Walnut Ave', city: 'Visalia', state: 'CA', zip: '93277',
    apn: '094-190-011', legalDescription: 'Lot 7 of Tract 1234', county: 'Tulare',
  },
  seller: {
    firstName: 'Maria', lastName: 'Delgado',
    secondaryFirstName: 'Luis', secondaryLastName: 'Delgado',
    isOrganization: false,
  },
  buyer: { firstName: 'Kevin', lastName: 'Tran', isOrganization: false },
  transaction: {
    type: 'Purchase', product: 'Residential Resale',
    salesAmount: 615000, loanAmount: 492000, coverageAmount: 615000,
    escrowNumber: '233370-GY', loanNumber: 'LN-77421',
    salesRep: '3001', titleOfficer: '5', escrowOfficer: '12',
    underwriterCode: 'WC',
  },
  contacts: {
    buyerAgent: { name: 'Dana Reyes', email: 'dana@kw.com', phone: '(559) 555-0111', companyName: 'Keller Williams' },
    listingAgent: { name: 'Omar Haddad', email: 'omar@c21.com', phone: '(559) 555-0122', companyName: 'Century 21' },
    lender: { name: 'Priya Nair', email: 'priya@wellsfargo.com', phone: '(800) 555-0133', companyName: 'Wells Fargo' },
    mortgageBroker: { name: 'Sam Ortiz', email: 'sam@brokerco.com', phone: '(559) 555-0144', companyName: 'BrokerCo' },
    escrowCompany: { name: 'Grace Yu', email: 'grace@atlasescrow.com', phone: '(626) 555-0134', companyName: 'Atlas Escrow' },
  },
  clientType: 'escrow_company',
};

/** Same order without the escrow side — the path that already works today. */
const TITLE_ONLY: CreateOrderInput = {
  ...TITLE_AND_ESCROW,
  orderType: 'Title only',
  transaction: { ...TITLE_AND_ESCROW.transaction, escrowOfficer: undefined },
};

const TITLE_ONLY_RESOLVED: ResolvedContacts = { ...RESOLVED, escrowOfficer: undefined };

function show(label: string, payload: Record<string, unknown>): void {
  const tx = payload.transactionDetails as Record<string, unknown>;
  console.log(`\n${'='.repeat(78)}\n${label}\n${'='.repeat(78)}`);
  console.log('--- the four fields under change ---');
  console.log(JSON.stringify({
    LookUpCodeTitleOffice: tx.LookUpCodeTitleOffice ?? null,
    TitleOffice: 'TitleOffice' in tx ? tx.TitleOffice : '(key absent)',
    LookUpCodeEscrowOfficer: tx.LookUpCodeEscrowOfficer ?? null,
    EscrowOfficerName: tx.EscrowOfficerName ?? null,
  }, null, 2));
  console.log(`--- top-level keys: ${Object.keys(payload).join(', ')}`);
  console.log('--- full payload ---');
  console.log(JSON.stringify(payload, null, 2));
}

show('TITLE & ESCROW — all six party types', buildSoftProPayload(TITLE_AND_ESCROW, ENRICHED, RESOLVED));
show('TITLE ONLY — regression check', buildSoftProPayload(TITLE_ONLY, ENRICHED, TITLE_ONLY_RESOLVED));
