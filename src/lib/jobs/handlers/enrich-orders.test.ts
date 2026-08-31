import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SoftProOrderContactsData } from '@/lib/integrations/softpro/types';

const getOrderContactsMock = vi.fn();
const selectLimitMock = vi.fn();
const updateSetMock = vi.fn();
const updateWhereMock = vi.fn();
const insertValuesMock = vi.fn();
const resolveClientContactIdMock = vi.fn();

// eq and and carry their operands through so the party-row tests can see WHICH
// (order_id, role, is_primary) triple the upsert looked for. That triple is the
// whole subject of those tests.
vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ op: 'and', conditions })),
  eq: vi.fn((field: unknown, value: unknown) => ({ op: 'eq', field, value })),
  isNull: vi.fn(() => ({})),
  or: vi.fn((...conditions: unknown[]) => ({ op: 'or', conditions })),
  sql: vi.fn(() => ({})),
}));

vi.mock('@/lib/db/schema', () => ({
  orders: {
    __table: 'orders',
    id: 'orders.id',
    fileNumber: 'orders.file_number',
    orderType: 'orders.order_type',
    updatedAt: 'orders.updated_at',
    contactsEmptyConfirmed: 'orders.contacts_empty_confirmed',
    lenderId: 'orders.lender_id',
    listingAgentId: 'orders.listing_agent_id',
    titleCompanyId: 'orders.title_company_id',
    underwriterId: 'orders.underwriter_id',
    clientContactId: 'orders.client_contact_id',
    lastContactsFetchAt: 'orders.last_contacts_fetch_at',
  },
  orderParties: {
    __table: 'order_parties',
    id: 'order_parties.id',
    orderId: 'order_parties.order_id',
    role: {
      __field: 'order_parties.role',
      enumValues: ['buyer', 'seller', 'buyer_agent', 'listing_agent', 'lender', 'lender_contact', 'escrow_company', 'other'],
    },
    isPrimary: 'order_parties.is_primary',
  },
  contacts: {
    __table: 'contacts',
    id: 'contacts.id',
    lookupCode: 'contacts.lookup_code',
    softproLookupCode: 'contacts.softpro_lookup_code',
    sourceId: 'contacts.source_id',
    fullName: 'contacts.full_name',
    email: 'contacts.email',
    phone: 'contacts.phone',
    companyName: 'contacts.company_name',
    flookupCode: 'contacts.flookup_code',
    isRealEstateAgent: 'contacts.is_real_estate_agent',
  },
  companies: {
    __table: 'companies',
    id: 'companies.id',
    lookupCode: 'companies.lookup_code',
    sourceId: 'companies.source_id',
    name: 'companies.name',
    email: 'companies.email',
    phone: 'companies.phone',
    isRealEstateCompany: 'companies.is_real_estate_company',
  },
  vendorApiLogs: {},
}));

vi.mock('@/lib/integrations/softpro', async () => {
  const mapper = await vi.importActual<typeof import('../../integrations/softpro/mapper')>(
    '../../integrations/softpro/mapper',
  );

  return {
    mapOrderContacts: mapper.mapOrderContacts,
    getOrderContacts: getOrderContactsMock,
  };
});

vi.mock('@/lib/domain/orders/client-resolver', () => ({
  resolveClientContactId: resolveClientContactIdMock,
}));

vi.mock('@/lib/db/client', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => ({
        where: vi.fn((condition: unknown) => ({
          limit: (n?: number) => selectLimitMock(n, table, condition),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: updateSetMock,
    })),
    insert: vi.fn((table: unknown) => ({
      values: (values: unknown) => insertValuesMock(values, table),
    })),
  },
}));

const softProEmptyContactsPayload: SoftProOrderContactsData = {
  buyer: {
    Person: {
      LookupCode: null,
      Name: null,
      Email: null,
      Phone: null,
      PrimaryBorrower: null,
      SecondaryBorrower: null,
    },
    Company: null,
    PrimaryBorrower: null,
    SecondaryBorrower: null,
    PreimaryBorrower: null,
  },
  Sellers: {
    PrimarySeller: null,
    SecondarySeller: null,
    PreimarySeller: null,
  },
  EscrowCompanies: {
    Company: null,
    Person: null,
    CompanyLookUpCode: null,
    PersonLookupCode: null,
  },
  Lenders: {
    Company: null,
    Person: null,
    CompanyLookUpCode: null,
    PersonLookupCode: null,
  },
  ListingAgentBrokers: {
    Company: null,
    Person: null,
    CompanyLookUpCode: null,
    PersonLookupCode: null,
  },
  BuyersAgentBrokers: {
    Company: null,
    Person: null,
    CompanyLookUpCode: null,
    PersonLookupCode: null,
  },
  MortgageBrokers: {
    Company: null,
    Person: null,
    CompanyLookUpCode: null,
    PersonLookupCode: null,
  },
  PayoffLenders: {
    Company: null,
    Person: null,
    CompanyLookUpCode: null,
    PersonLookupCode: null,
  },
  TitleCompanies: {
    Company: null,
    Person: null,
    CompanyLookUpCode: null,
    PersonLookupCode: null,
  },
  Underwriters: {
    Company: null,
    Person: null,
    CompanyLookUpCode: null,
    PersonLookupCode: null,
  },
};

/**
 * Verbatim shape of `BuyersAgentBrokers` on 20017694-ONT, read from production
 * SoftPro on 27 Aug 2026. The nulls are the measurement, not filler: the vendor
 * supplies a person name and a company name and NO email, phone or lookup code
 * on this role, which is why mapping it adds no email recipient.
 */
const softProBuyerAgentPayload: SoftProOrderContactsData = {
  ...softProEmptyContactsPayload,
  BuyersAgentBrokers: {
    Person: { LookupCode: null, Name: 'Leonard Bustos', Email: null, Phone: null },
    Company: {
      LookupCode: null, Name: 'Moving Results Realty', Email: null, Phone: null,
      Address: null, City: null, State: null, Zip: null,
    },
    CompanyLookUpCode: null,
    PersonLookupCode: null,
  },
};

/** Party-row inserts only — `db.insert` is shared with vendor_api_logs here. */
function insertedPartyRows(): Array<Record<string, unknown>> {
  return insertValuesMock.mock.calls
    .map((call) => call[0] as Record<string, unknown>)
    .filter((values) => typeof values?.role === 'string' && 'orderId' in values);
}

describe('BuyersAgentBrokers → buyer_agent party row', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateSetMock.mockReturnValue({ where: updateWhereMock });
    updateWhereMock.mockResolvedValue(undefined);
    insertValuesMock.mockResolvedValue(undefined);
    resolveClientContactIdMock.mockResolvedValue(null);
  });

  it('creates a buyer_agent row from a real-shaped BuyersAgentBrokers payload', async () => {
    // First select is the order lookup; every later one is a resolution probe
    // that must come back empty so the upsert takes the insert branch.
    selectLimitMock
      .mockResolvedValueOnce([{ id: 501, fileNumber: '20017694-ONT', orderType: 'Sale' }])
      .mockResolvedValue([]);
    getOrderContactsMock.mockResolvedValue({ success: true, data: softProBuyerAgentPayload });

    const { enrichSingleOrder } = await import('./enrich-orders');
    const result = await enrichSingleOrder(501);

    expect(result).toMatchObject({
      success: true,
      outcome: 'parties_written',
      partiesWritten: 1,
      contactsEmptyConfirmed: false,
    });

    const parties = insertedPartyRows();
    expect(parties).toHaveLength(1);
    expect(parties[0]).toMatchObject({
      orderId: 501,
      role: 'buyer_agent',
      isPrimary: true,
      externalName: 'Leonard Bustos',
      externalCompany: 'Moving Results Realty',
      // The measured fact this change turns on: a row, and no new recipient.
      externalEmail: null,
      contactId: null,
    });
  });

  it('creates nothing when BuyersAgentBrokers is present but empty', async () => {
    selectLimitMock
      .mockResolvedValueOnce([{ id: 502, fileNumber: '20018364-GLT', orderType: 'Sale' }])
      .mockResolvedValue([]);
    getOrderContactsMock.mockResolvedValue({ success: true, data: softProEmptyContactsPayload });

    const { enrichSingleOrder } = await import('./enrich-orders');
    const result = await enrichSingleOrder(502);

    expect(result).toMatchObject({ outcome: 'empty_confirmed', partiesWritten: 0 });
    expect(insertedPartyRows()).toHaveLength(0);
  });
});

describe('enrichSingleOrder empty contact confirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectLimitMock.mockResolvedValue([
      { id: 123, fileNumber: 'EMPTY-REAL-SOFTPRO', orderType: 'Sale' },
    ]);
    updateSetMock.mockReturnValue({ where: updateWhereMock });
    updateWhereMock.mockResolvedValue(undefined);
    insertValuesMock.mockResolvedValue(undefined);
    resolveClientContactIdMock.mockResolvedValue(null);
    getOrderContactsMock.mockResolvedValue({
      success: true,
      data: softProEmptyContactsPayload,
    });
  });

  it('marks an order empty_confirmed when SoftPro returns section labels with null values', async () => {
    const { enrichSingleOrder } = await import('./enrich-orders');

    const result = await enrichSingleOrder(123);

    expect(result).toMatchObject({
      success: true,
      orderId: 123,
      fileNumber: 'EMPTY-REAL-SOFTPRO',
      outcome: 'empty_confirmed',
      contactsEmptyConfirmed: true,
      partiesWritten: 0,
    });
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ contactsEmptyConfirmed: true }),
    );
  });
});

// ─── upsertResolvedParty matches on (order_id, role, is_primary) ────────────
//
// upsertResolvedParty SELECTs order_parties on that exact triple and INSERTs
// when it misses — it never deletes. It asks for is_primary = true for lender,
// listing_agent, escrow_company and lender_contact, which are four of the five
// roles the open-order form collects.
//
// create-order used to omit the column and take the default of false, so every
// one of those lookups missed on a hub-created order and this handler added a
// second row for a party the operator had already entered, leaving the row that
// carries their resolved contact_id behind for nothing to read.

const ORDER_ID = 123;
const OPERATOR_CONTACT_ID = 7101;

/** SoftPro reporting a lender company back for the same order. */
const softProLenderPayload: SoftProOrderContactsData = {
  ...softProEmptyContactsPayload,
  Lenders: {
    Company: {
      LookupCode: 'BarrFinaGrou',
      // The vendor's canonical spelling of what the operator typed.
      Name: 'Barrett Financial Group, Inc.',
      Email: null,
      Phone: null,
    },
    Person: null,
    CompanyLookUpCode: null,
    PersonLookupCode: null,
  },
};

/** The lender row the operator entered through the hub form. */
function operatorLenderRow(isPrimary: boolean) {
  return {
    id: 33,
    orderId: ORDER_ID,
    role: 'lender',
    isPrimary,
    contactId: OPERATOR_CONTACT_ID,
    externalName: 'Lender Person',
    externalCompany: 'Barrett Financial Group',
    externalEmail: 'lender@example.com',
    externalPhone: '555-0101',
  };
}

/**
 * Flatten a captured and(eq(...), ...) condition into field/value pairs. Most
 * mocked columns are plain strings; the enum-backed ones carry __field instead.
 */
function conditionFields(condition: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const n = node as { op?: string; conditions?: unknown[]; field?: unknown; value?: unknown };
    const key = typeof n.field === 'string'
      ? n.field
      : (n.field as { __field?: string } | null)?.__field;
    if (n.op === 'eq' && key) out[key] = n.value;
    if (n.conditions) n.conditions.forEach(walk);
  };
  walk(condition);
  return out;
}

describe('enrichSingleOrder party upsert', () => {
  /** order_parties rows the order already has, keyed by nothing but the triple. */
  let existingParties: Array<Record<string, unknown>> = [];
  /** The order_parties lookups the handler issued. */
  let partyLookups: Array<Record<string, unknown>> = [];

  beforeEach(() => {
    vi.clearAllMocks();
    existingParties = [];
    partyLookups = [];

    updateSetMock.mockReturnValue({ where: updateWhereMock });
    updateWhereMock.mockResolvedValue(undefined);
    insertValuesMock.mockResolvedValue(undefined);
    resolveClientContactIdMock.mockResolvedValue(null);
    getOrderContactsMock.mockResolvedValue({ success: true, data: softProLenderPayload });

    selectLimitMock.mockImplementation(async (
      _limit: number | undefined,
      table: { __table?: string } | undefined,
      condition: unknown,
    ) => {
      if (table?.__table === 'orders') {
        return [{ id: ORDER_ID, fileNumber: 'LENDER-READBACK', orderType: 'Sale' }];
      }
      if (table?.__table === 'order_parties') {
        const want = conditionFields(condition);
        partyLookups.push(want);
        return existingParties.filter((row) => (
          row.orderId === want['order_parties.order_id']
          && row.role === want['order_parties.role']
          && row.isPrimary === want['order_parties.is_primary']
        ));
      }
      // No matching contacts or companies master rows — keeps the identity the
      // vendor payload alone, which is all these tests care about.
      return [];
    });
  });

  function partyInserts() {
    return insertValuesMock.mock.calls
      .filter((call) => (call[1] as { __table?: string } | undefined)?.__table === 'order_parties')
      .map((call) => call[0] as Record<string, unknown>);
  }

  it('looks the lender up on is_primary = true, which is the key create-order must write', async () => {
    existingParties = [operatorLenderRow(true)];
    const { enrichSingleOrder } = await import('./enrich-orders');

    await enrichSingleOrder(ORDER_ID);

    expect(partyLookups).toContainEqual({
      'order_parties.order_id': ORDER_ID,
      'order_parties.role': 'lender',
      'order_parties.is_primary': true,
    });
  });

  it('updates the operator row instead of adding a second lender', async () => {
    existingParties = [operatorLenderRow(true)];
    const { enrichSingleOrder } = await import('./enrich-orders');

    const result = await enrichSingleOrder(ORDER_ID);

    expect(result.partiesWritten).toBe(1);
    expect(partyInserts()).toHaveLength(0);
    // Per-field and non-empty-only: the vendor's company name lands, and the
    // contact_id the typeahead resolved is not in the update at all.
    expect(updateSetMock).toHaveBeenCalledWith({ externalCompany: 'Barrett Financial Group, Inc.' });
    const written = updateSetMock.mock.calls.map((c) => c[0] as Record<string, unknown>);
    for (const values of written) {
      expect(values).not.toHaveProperty('contactId');
      expect(values).not.toHaveProperty('externalEmail');
    }
  });

  // The bug, characterised. Kept so that nobody "fixes" the duplicate by
  // loosening this lookup instead of writing the flag at create time.
  it('does NOT find a non-primary row, and inserts a second lender beside it', async () => {
    existingParties = [operatorLenderRow(false)];
    const { enrichSingleOrder } = await import('./enrich-orders');

    await enrichSingleOrder(ORDER_ID);

    const inserted = partyInserts();
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      orderId: ORDER_ID,
      role: 'lender',
      isPrimary: true,
      externalCompany: 'Barrett Financial Group, Inc.',
    });
    // The operator's contact_id is on the row this insert has just orphaned.
    expect(inserted[0]!.contactId).toBeNull();
  });

  it('still inserts when the order genuinely has no lender row', async () => {
    existingParties = [];
    const { enrichSingleOrder } = await import('./enrich-orders');

    await enrichSingleOrder(ORDER_ID);

    expect(partyInserts()).toHaveLength(1);
    expect(partyInserts()[0]).toMatchObject({ role: 'lender', isPrimary: true });
  });
});

let existingPartiesForLatch: Array<Record<string, unknown>> = [];

const softProListingAgentPayload: SoftProOrderContactsData = {
  ...softProEmptyContactsPayload,
  ListingAgentBrokers: {
    Person: { LookupCode: null, Name: 'J SMITH FROM SOFTPRO', Email: 'other@softpro.example', Phone: '555-9999' },
    Company: {
      LookupCode: null, Name: 'Vendor Brokerage', Email: null, Phone: null,
      Address: null, City: null, State: null, Zip: null,
    },
    CompanyLookUpCode: null,
    PersonLookupCode: null,
  },
};

describe('confirmed listing agent outranks SoftPro enrich', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    existingPartiesForLatch = [];
    updateSetMock.mockReturnValue({ where: updateWhereMock });
    updateWhereMock.mockResolvedValue(undefined);
    insertValuesMock.mockResolvedValue(undefined);
    resolveClientContactIdMock.mockResolvedValue(null);
    getOrderContactsMock.mockResolvedValue({ success: true, data: softProListingAgentPayload });
  });

  it('does not clobber a confirmed name or email; empty phone/company may still fill', async () => {
    existingPartiesForLatch = [{
      id: 88,
      orderId: ORDER_ID,
      role: 'listing_agent',
      isPrimary: true,
      partyConfirmedAt: new Date('2026-08-31T17:00:00Z'),
      externalName: 'Jane Smith',
      externalEmail: 'jane@coastrealty.com',
      externalPhone: null,
      externalCompany: null,
    }];
    selectLimitMock.mockImplementation(async (
      _limit: number | undefined,
      table: { __table?: string } | undefined,
      condition: unknown,
    ) => {
      if (table?.__table === 'orders') {
        return [{ id: ORDER_ID, fileNumber: 'CONFIRMED-LA', orderType: 'Sale' }];
      }
      if (table?.__table === 'order_parties') {
        const want = conditionFields(condition);
        return existingPartiesForLatch.filter((row) => (
          row.orderId === want['order_parties.order_id']
          && row.role === want['order_parties.role']
          && row.isPrimary === want['order_parties.is_primary']
        ));
      }
      return [];
    });

    const { enrichSingleOrder } = await import('./enrich-orders');
    await enrichSingleOrder(ORDER_ID);

    const written = updateSetMock.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .filter((v) => 'externalName' in v || 'externalEmail' in v || 'externalPhone' in v || 'externalCompany' in v);
    expect(written).toHaveLength(1);
    expect(written[0]).toEqual({
      externalPhone: '555-9999',
      externalCompany: 'Vendor Brokerage',
    });
    expect(written[0]).not.toHaveProperty('externalName');
    expect(written[0]).not.toHaveProperty('externalEmail');
  });
});
