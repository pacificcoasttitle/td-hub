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
vi.mock('./softpro-payload', () => ({ buildSoftProPayload: vi.fn(() => ({})) }));

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
    branchCode: 'PCT',
  },
};

/** The values handed to the FIRST insert — the orders row. */
function ordersInsert() {
  return insertValuesMock.mock.calls[0]![0] as Record<string, unknown>;
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
