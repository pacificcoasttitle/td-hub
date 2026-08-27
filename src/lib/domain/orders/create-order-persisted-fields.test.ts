import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── What createLocalRecords actually writes ────────────────────────────────
//
// createLocalRecords wrote a subset of the create input, and three of the
// fields that fell out of it were only noticed when someone read a confirmation
// email: sales rep, title officer and loan amount were sent to SoftPro and left
// NULL locally. escrow_officer_id was in the same state, which is the upstream
// half of escrow_officer_id being NULL on 2,465 of 4,068 active orders.
//
// These tests assert the insert payload directly, because "the form collected
// it and SoftPro received it" has repeatedly not meant "the order carries it".

const {
  softproCreateMock,
  autoTriggerMock,
  getSettingMock,
  insertValuesMock,
  returningMock,
  dbState,
} = vi.hoisted(() => ({
  softproCreateMock: vi.fn(),
  autoTriggerMock: vi.fn(),
  getSettingMock: vi.fn(),
  insertValuesMock: vi.fn(),
  returningMock: vi.fn(),
  dbState: { contacts: [] as unknown[], companies: [] as unknown[], branches: [] as unknown[] },
}));

vi.mock('@/lib/integrations/sitex/client', () => ({ propertyLookup: vi.fn() }));
vi.mock('@/lib/integrations/softpro', () => ({
  createOrder: (...args: unknown[]) => softproCreateMock(...args),
}));
vi.mock('@/lib/domain/titlepoint/pre-initiate', () => ({ linkSessionToOrder: vi.fn() }));
vi.mock('@/lib/domain/titlepoint/service', () => ({ initiateSearch: vi.fn() }));
vi.mock('@/lib/domain/titlepoint/auto-trigger', () => ({
  autoTriggerTitlePoint: (...args: unknown[]) => autoTriggerMock(...args),
}));
vi.mock('@/lib/domain/settings/service', () => ({
  getSetting: (...args: unknown[]) => getSettingMock(...args),
}));
vi.mock('@/lib/integrations/titlepoint/fips', () => ({ resolveCaliforniaFips: () => '06037' }));
vi.mock('./softpro-payload', () => ({
  buildSoftProPayload: vi.fn(() => ({})),
  assertKnownTitleOffice: vi.fn(),
  SoftProPayloadError: class extends Error {},
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...a: unknown[]) => a),
  and: vi.fn((...a: unknown[]) => a),
  inArray: vi.fn((...a: unknown[]) => a),
}));

vi.mock('@/lib/db/schema', () => ({
  orders: { __t: 'orders', id: 'orders.id' },
  orderProperties: { __t: 'orderProperties' },
  orderParties: { __t: 'orderParties' },
  orderStatusHistory: { __t: 'orderStatusHistory' },
  eventOutbox: { __t: 'eventOutbox' },
  companies: { __t: 'companies', id: 'x', lookupCode: 'x', isUnderwriter: 'x', branchId: 'x' },
  contacts: { __t: 'contacts', id: 'x' },
  branches: { __t: 'branches', id: 'x', code: 'x' },
}));

vi.mock('@/lib/db/client', () => {
  // Drizzle chains are thenable, and the code awaits some queries directly and
  // others through .limit(1). Support both.
  const query = (rows: unknown[]) => {
    const self: Record<string, unknown> = {};
    self.where = () => self;
    self.limit = async () => rows;
    self.then = (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(ok, err);
    return self;
  };
  return {
    db: {
      select: () => ({
        from: (t: { __t?: 'contacts' | 'companies' | 'branches' }) =>
          query(t?.__t && t.__t in dbState ? dbState[t.__t] : []),
      }),
      insert: () => ({
        values: (v: unknown) => {
          insertValuesMock(v);
          return { returning: returningMock };
        },
      }),
    },
  };
});

import { createAndSendToSoftPro } from './create-order';

const SALES_REP_ID = 7001;
const TITLE_OFFICER_ID = 7002;
const ESCROW_OFFICER_ID = 7003;
const CLIENT_ID = 13233;

function contactRow(id: number, lookupCode: string) {
  return {
    id,
    fullName: `Contact ${id}`,
    firstName: 'A',
    lastName: 'B',
    email: null,
    phone: null,
    companyName: null,
    lookupCode,
    flookupCode: null,
    officeLookupCode: null,
    softproLookupCode: lookupCode,
    officerName: null,
    softproUserType: null,
    userType: null,
    address1: null,
    city: null,
    state: null,
    zip: null,
  };
}

const baseInput = {
  orderType: 'Title only' as const,
  isRushOrder: false,
  property: {
    address: '8641 Universe Ave',
    city: 'Westminster',
    state: 'CA',
    zip: '92683',
    apn: '107-493-04',
    legalDescription: 'N TR 9185 BLK LOT 4',
    county: 'Orange',
  },
  seller: { firstName: 'A', lastName: 'B' },
  buyer: { firstName: 'C', lastName: 'D' },
  transaction: {
    type: 'Refinance' as const,
    product: 'Short Form',
    salesAmount: 0,
    loanAmount: 0,
    coverageAmount: 0,
  },
};

const LENDER_ID = 7101;
const LISTING_AGENT_ID = 7102;
const BUYER_AGENT_ID = 7103;
const MORTGAGE_BROKER_ID = 7104;
const ESCROW_COMPANY_CONTACT_ID = 7105;

/** The values handed to the FIRST insert — the orders row. */
function ordersInsert() {
  return insertValuesMock.mock.calls[0]![0] as Record<string, unknown>;
}

/**
 * The values handed to the THIRD insert — the order_parties rows. Order is
 * orders, order_properties, order_parties, order_status_history.
 */
function partyInserts() {
  return insertValuesMock.mock.calls[2]![0] as Array<Record<string, unknown>>;
}

function partyByRole(role: string) {
  return partyInserts().filter((p) => p.role === role);
}

describe('createLocalRecords persists what the operator entered', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbState.contacts = [];
    dbState.companies = [];
    dbState.branches = [];
    softproCreateMock.mockResolvedValue({ success: true, data: { orderNumber: '20021376-OCT' } });
    returningMock.mockResolvedValue([{ id: 7308 }]);
    autoTriggerMock.mockResolvedValue({ initiated: 0, failed: 0, skipped: true });
    getSettingMock.mockResolvedValue('false');
  });

  it('BEFORE-shape: nothing entered leaves every optional column NULL', async () => {
    const result = await createAndSendToSoftPro(baseInput);
    expect(result.success).toBe(true);

    const row = ordersInsert();
    expect(row).toMatchObject({
      salesRepId: null,
      titleOfficerId: null,
      escrowOfficerId: null,
      loanAmount: null,
      loanNumber: null,
      escrowNumber: null,
      clientContactId: null,
      lenderId: null,
      listingAgentId: null,
    });
  });

  it('AFTER: assignments, loan amount, loan number and escrow number are all written', async () => {
    dbState.contacts = [
      contactRow(SALES_REP_ID, 'PCT\\awu'),
      contactRow(TITLE_OFFICER_ID, 'PCT\\cvirata'),
      contactRow(ESCROW_OFFICER_ID, 'PCT\\eofficer'),
      contactRow(CLIENT_ID, 'GraYuAtla'),
    ];

    await createAndSendToSoftPro({
      ...baseInput,
      onBehalfOfContactId: CLIENT_ID,
      transaction: {
        ...baseInput.transaction,
        loanAmount: 550000,
        loanNumber: 'LN-77421',
        escrowNumber: '233370-GY',
        salesRep: String(SALES_REP_ID),
        titleOfficer: String(TITLE_OFFICER_ID),
        escrowOfficer: String(ESCROW_OFFICER_ID),
      },
    });

    const row = ordersInsert();
    expect(row).toMatchObject({
      salesRepId: SALES_REP_ID,
      titleOfficerId: TITLE_OFFICER_ID,
      escrowOfficerId: ESCROW_OFFICER_ID,
      loanAmount: '550000',
      loanNumber: 'LN-77421',
      escrowNumber: '233370-GY',
      clientContactId: CLIENT_ID,
    });
  });

  // The FK must come from the row that was actually resolved and used to build
  // the SoftPro payload. Coercing the raw input string would let the order
  // reference a contact that does not exist and blow up on the constraint.
  it('an unresolvable assignment id is dropped rather than written blindly', async () => {
    dbState.contacts = [contactRow(SALES_REP_ID, 'PCT\\awu')];

    await createAndSendToSoftPro({
      ...baseInput,
      transaction: {
        ...baseInput.transaction,
        salesRep: String(SALES_REP_ID),
        titleOfficer: '999999',
      },
    });

    const row = ordersInsert();
    expect(row.salesRepId).toBe(SALES_REP_ID);
    expect(row.titleOfficerId).toBeNull();
  });

  // A loan amount of 0 is "not entered" on this form. Writing 0.00 would render
  // downstream as a real amount of nothing.
  it('a zero loan amount stays NULL rather than becoming 0.00', async () => {
    await createAndSendToSoftPro({
      ...baseInput,
      transaction: { ...baseInput.transaction, loanAmount: 0 },
    });
    expect(ordersInsert().loanAmount).toBeNull();
  });

  it('an empty loan or escrow number stays NULL rather than an empty string', async () => {
    await createAndSendToSoftPro({
      ...baseInput,
      transaction: { ...baseInput.transaction, loanNumber: '', escrowNumber: '' },
    });
    const row = ordersInsert();
    expect(row.loanNumber).toBeNull();
    expect(row.escrowNumber).toBeNull();
  });
});

// ─── Transaction parties ────────────────────────────────────────────────────
//
// The typeahead resolves a real contacts row and sends its lookup codes to
// SoftPro, so the vendor can identify the party. The id behind that same row was
// then thrown away, which left orders.lender_id, orders.listing_agent_id and
// every order_parties.contact_id NULL on hub-created orders — permanently, since
// the enrich-orders read-back does not reach a hub order that already has a
// client, an underwriter and party rows.
//
// Free text is the other half of this form. A party nobody picked from the
// typeahead must still be written, with no contact link.

describe('createLocalRecords links the parties the operator picked', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbState.contacts = [];
    dbState.companies = [];
    dbState.branches = [];
    softproCreateMock.mockResolvedValue({ success: true, data: { orderNumber: '20021376-OCT' } });
    returningMock.mockResolvedValue([{ id: 7308 }]);
    autoTriggerMock.mockResolvedValue({ initiated: 0, failed: 0, skipped: true });
    getSettingMock.mockResolvedValue('false');
  });

  const allPartiesSelected = {
    ...baseInput,
    contacts: {
      lender: {
        contactId: LENDER_ID,
        name: 'Lender Person',
        companyName: 'Barrett Financial Group',
        clientLookupCode: 'LenPerBarr',
        companyLookupCode: 'BarrFinaGrou',
      },
      listingAgent: {
        contactId: LISTING_AGENT_ID,
        name: 'Listing Person',
        email: 'listing@example.com',
      },
      buyerAgent: {
        contactId: BUYER_AGENT_ID,
        name: 'Buyer Agent Person',
        email: 'buyeragent@example.com',
      },
      mortgageBroker: {
        contactId: MORTGAGE_BROKER_ID,
        name: 'Broker Person',
        email: 'broker@example.com',
      },
      escrowCompany: {
        contactId: ESCROW_COMPANY_CONTACT_ID,
        name: 'Escrow Person',
        companyName: 'Newport Financial Associates, Escrow Division',
      },
    },
  };

  function seedAllParties() {
    dbState.contacts = [
      contactRow(LENDER_ID, 'LenPerBarr'),
      contactRow(LISTING_AGENT_ID, 'LisPer'),
      contactRow(BUYER_AGENT_ID, 'BuyPer'),
      contactRow(MORTGAGE_BROKER_ID, 'BroPer'),
      contactRow(ESCROW_COMPANY_CONTACT_ID, 'EscPer'),
    ];
  }

  it('the lender and listing agent picks land in their own columns', async () => {
    seedAllParties();
    await createAndSendToSoftPro(allPartiesSelected);

    const row = ordersInsert();
    expect(row.lenderId).toBe(LENDER_ID);
    expect(row.listingAgentId).toBe(LISTING_AGENT_ID);
  });

  it('every picked party row carries the contact id it was picked from', async () => {
    seedAllParties();
    await createAndSendToSoftPro(allPartiesSelected);

    expect(partyByRole('lender')[0]).toMatchObject({
      contactId: LENDER_ID,
      externalName: 'Lender Person',
      externalCompany: 'Barrett Financial Group',
    });
    expect(partyByRole('listing_agent')[0]!.contactId).toBe(LISTING_AGENT_ID);
    expect(partyByRole('buyer_agent')[0]!.contactId).toBe(BUYER_AGENT_ID);
    expect(partyByRole('escrow_company')[0]!.contactId).toBe(ESCROW_COMPANY_CONTACT_ID);
  });

  // party_role has no mortgage_broker value, so this party had no local row at
  // all. lender_contact is the role the SoftPro read-back already files a
  // mortgage broker under, so both writers land on one row.
  it('the mortgage broker is written as lender_contact rather than dropped', async () => {
    seedAllParties();
    await createAndSendToSoftPro(allPartiesSelected);

    const broker = partyByRole('lender_contact');
    expect(broker).toHaveLength(1);
    expect(broker[0]).toMatchObject({
      contactId: MORTGAGE_BROKER_ID,
      externalName: 'Broker Person',
      externalEmail: 'broker@example.com',
    });
    expect(partyInserts().some((p) => p.role === 'mortgage_broker')).toBe(false);
  });

  it('a free-text party is written with a null contact id, not dropped', async () => {
    await createAndSendToSoftPro({
      ...baseInput,
      contacts: {
        lender: { name: 'Typed Lender', companyName: 'Some Bank Nobody Synced' },
        listingAgent: { name: 'Typed Agent', email: 'typed@example.com' },
      },
    });

    const row = ordersInsert();
    expect(row.lenderId).toBeNull();
    expect(row.listingAgentId).toBeNull();

    expect(partyByRole('lender')[0]).toMatchObject({
      contactId: null,
      externalName: 'Typed Lender',
      externalCompany: 'Some Bank Nobody Synced',
    });
    expect(partyByRole('listing_agent')[0]).toMatchObject({
      contactId: null,
      externalName: 'Typed Agent',
      externalEmail: 'typed@example.com',
    });
  });

  // The company-first typeahead (lender, escrow company) mixes companies into
  // the same suggestion list. A company is not a contact, so picking one leaves
  // the party with lookup codes and no contact id — it must still persist.
  it('a company-only pick persists the party without inventing a contact id', async () => {
    await createAndSendToSoftPro({
      ...baseInput,
      contacts: {
        lender: {
          name: '',
          companyName: 'Barrett Financial Group',
          companyLookupCode: 'BarrFinaGrou',
        },
      },
    });

    expect(ordersInsert().lenderId).toBeNull();
    expect(partyByRole('lender')[0]).toMatchObject({
      contactId: null,
      externalCompany: 'Barrett Financial Group',
    });
  });

  // Same rule as the officer FKs: the id must come from a row that came back
  // from the contacts lookup, never from the number the client sent.
  it('a contact id that resolves to nothing is dropped, and the party still persists', async () => {
    dbState.contacts = [contactRow(LISTING_AGENT_ID, 'LisPer')];

    await createAndSendToSoftPro({
      ...baseInput,
      contacts: {
        lender: { contactId: 999999, name: 'Ghost Lender', email: 'ghost@example.com' },
        listingAgent: { contactId: LISTING_AGENT_ID, name: 'Listing Person', email: 'listing@example.com' },
      },
    });

    const row = ordersInsert();
    expect(row.lenderId).toBeNull();
    expect(row.listingAgentId).toBe(LISTING_AGENT_ID);

    expect(partyByRole('lender')[0]).toMatchObject({
      contactId: null,
      externalName: 'Ghost Lender',
    });
  });

  // A party the operator never opened is absent from input.contacts entirely and
  // must not produce a row, which is how it behaves today.
  it('an untouched party produces no row at all', async () => {
    await createAndSendToSoftPro(baseInput);

    const roles = partyInserts().map((p) => p.role);
    expect(roles).toEqual(['seller', 'buyer']);
    expect(partyInserts().every((p) => p.contactId === undefined)).toBe(true);
  });
});
