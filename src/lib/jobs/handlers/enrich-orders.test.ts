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
      enumValues: ['buyer', 'seller', 'lender', 'listing_agent', 'escrow_company', 'lender_contact', 'other'],
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
