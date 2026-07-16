import { beforeEach, describe, expect, it, vi } from 'vitest';

const orderUpdateSets: Array<Record<string, unknown>> = [];
const existingRows: Array<{ id: number; operationalStatus: string }> = [];

vi.mock('drizzle-orm', () => ({
  eq: (field: unknown, value: unknown) => ({ op: 'eq', field, value }),
}));

vi.mock('@/lib/integrations/softpro/types', () => ({
  parseSoftProDate: () => null,
}));

vi.mock('@/lib/db/schema', () => ({
  orders: {
    __table: 'orders',
    id: 'orders.id',
    fileNumber: 'orders.file_number',
    operationalStatus: 'orders.operational_status',
  },
  orderProperties: {
    __table: 'order_properties',
    id: 'order_properties.id',
    orderId: 'order_properties.order_id',
  },
  orderStatusHistory: { __table: 'order_status_history' },
  contacts: {
    __table: 'contacts',
    id: 'contacts.id',
    firstName: 'contacts.first_name',
    lastName: 'contacts.last_name',
    fullName: 'contacts.full_name',
    officerName: 'contacts.officer_name',
    softproLookupCode: 'contacts.softpro_lookup_code',
    sourceId: 'contacts.source_id',
    email: 'contacts.email',
    phone: 'contacts.phone',
    isSalesRep: 'contacts.is_sales_rep',
    isTitleOfficer: 'contacts.is_title_officer',
    isEscrowOfficer: 'contacts.is_escrow_officer',
  },
}));

vi.mock('@/lib/db/client', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn((table: { __table?: string }) => {
        if (table.__table === 'orders') {
          return {
            where: vi.fn(() => ({
              limit: vi.fn(async () => existingRows),
            })),
          };
        }
        if (table.__table === 'order_properties') {
          return {
            where: vi.fn(() => ({
              limit: vi.fn(async () => []),
            })),
          };
        }
        return {
          where: vi.fn(() => ({
            limit: vi.fn(async () => []),
          })),
        };
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => {
        orderUpdateSets.push(values);
        return {
          where: vi.fn(async () => undefined),
        };
      }),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(async () => undefined),
    })),
  },
}));

import { processOrderDetail } from './process-detail';

type DetailInput = Parameters<typeof processOrderDetail>[0];

function detail(overrides: Partial<DetailInput> = {}): DetailInput {
  return {
    OrderNumber: '20018881-OCT',
    OrderStatus: '',
    MarketingSource: '',
    OrderType: '',
    Address: '',
    City: '',
    State: '',
    Country: '',
    TitleOfficer: '',
    SalesPrice: '',
    TransactionType: '',
    ProductType: '',
    ReceivedDate: '',
    CompletedDate: '',
    ModifiedDate: '',
    MarketingRep: '',
    ...overrides,
  };
}

describe('processOrderDetail preserveExistingOnEmpty', () => {
  beforeEach(() => {
    orderUpdateSets.length = 0;
    existingRows.splice(0, existingRows.length, {
      id: 42,
      operationalStatus: 'in_process',
    });
  });

  it('preserves existing SoftPro fields and status when SoftPro returns blanks (resync)', async () => {
    await processOrderDetail(detail(), {
      preserveExistingOnEmpty: true,
      salesReps: [],
      titleOfficers: [],
      escrowOfficers: [],
    });

    expect(orderUpdateSets).toHaveLength(1);
    const set = orderUpdateSets[0]!;
    expect(set).not.toHaveProperty('softproStatus');
    expect(set).not.toHaveProperty('operationalStatus');
    expect(set.productType).toBeUndefined();
    expect(set.orderType).toBeUndefined();
    expect(set.transactionType).toBeUndefined();
    expect(set.marketingSource).toBeUndefined();
  });

  it('updates SoftPro fields and status when SoftPro provides new values (resync)', async () => {
    await processOrderDetail(
      detail({
        OrderStatus: 'Completed',
        ProductType: 'Owner Policy',
        OrderType: 'Purchase',
        TransactionType: 'Refinance',
        MarketingSource: 'Referral',
      }),
      { preserveExistingOnEmpty: true, salesReps: [], titleOfficers: [], escrowOfficers: [] },
    );

    expect(orderUpdateSets).toHaveLength(1);
    const set = orderUpdateSets[0]!;
    expect(set.softproStatus).toBe('completed');
    expect(set.operationalStatus).toBe('completed');
    expect(set.productType).toBe('Owner Policy');
    expect(set.orderType).toBe('Purchase');
    expect(set.transactionType).toBe('Refinance');
    expect(set.marketingSource).toBe('Referral');
  });

  it('default (import/webhook) nulls empty SoftPro fields but never guesses operational_status open', async () => {
    const payload = detail({
      ProductType: '',
      OrderType: '',
      TransactionType: '',
      MarketingSource: '',
    });
    // Absent OrderStatus (not empty string) — matches import/webhook nullish default.
    delete (payload as { OrderStatus?: string }).OrderStatus;

    await processOrderDetail(payload, {
      salesReps: [],
      titleOfficers: [],
      escrowOfficers: [],
    });

    expect(orderUpdateSets).toHaveLength(1);
    const set = orderUpdateSets[0]!;
    expect(set.softproStatus).toBeNull();
    expect(set).not.toHaveProperty('operationalStatus');
    expect(set.productType).toBeNull();
    expect(set.orderType).toBeNull();
    expect(set.transactionType).toBeNull();
    expect(set.marketingSource).toBeNull();
  });

  it('maps SoftPro Hold to hold and updates operational_status', async () => {
    await processOrderDetail(
      detail({ OrderStatus: 'Hold' }),
      { salesReps: [], titleOfficers: [], escrowOfficers: [] },
    );

    expect(orderUpdateSets).toHaveLength(1);
    const set = orderUpdateSets[0]!;
    expect(set.softproStatus).toBe('hold');
    expect(set.operationalStatus).toBe('hold');
  });

  it('preserves operational_status when SoftPro status is unknown (does not guess open)', async () => {
    await processOrderDetail(
      detail({ OrderStatus: 'Pending Supervisor Review' }),
      { salesReps: [], titleOfficers: [], escrowOfficers: [] },
    );

    expect(orderUpdateSets).toHaveLength(1);
    const set = orderUpdateSets[0]!;
    expect(set.softproStatus).toBe('pending supervisor review');
    expect(set).not.toHaveProperty('operationalStatus');
  });
});
