import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  orderUpdateSets,
  getOrderDetailsMock,
  candidates,
  existingOrderRows,
} = vi.hoisted(() => ({
  orderUpdateSets: [] as Array<Record<string, unknown>>,
  getOrderDetailsMock: vi.fn(),
  candidates: [{ id: 42, fileNumber: '20018881-OCT', lastDetailsFetchAt: null as Date | null }],
  existingOrderRows: [{ id: 42, operationalStatus: 'in_process' }],
}));

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ op: 'and', args }),
  asc: (v: unknown) => v,
  eq: (field: unknown, value: unknown) => ({ op: 'eq', field, value }),
  isNull: (v: unknown) => ({ op: 'isNull', v }),
  lt: (a: unknown, b: unknown) => ({ op: 'lt', a, b }),
  or: (...args: unknown[]) => ({ op: 'or', args }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    op: 'sql',
    strings,
    values,
  }),
}));

vi.mock('@/lib/db/schema', () => ({
  orders: {
    __table: 'orders',
    id: 'orders.id',
    fileNumber: 'orders.file_number',
    operationalStatus: 'orders.operational_status',
    source: 'orders.source',
    salesRepId: 'orders.sales_rep_id',
    titleOfficerId: 'orders.title_officer_id',
    escrowOfficerId: 'orders.escrow_officer_id',
    lastDetailsFetchAt: 'orders.last_details_fetch_at',
    detailsAttemptCount: 'orders.details_attempt_count',
  },
  orderProperties: {
    __table: 'order_properties',
    id: 'order_properties.id',
    orderId: 'order_properties.order_id',
    address: 'order_properties.address',
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

vi.mock('@/lib/integrations/softpro/types', () => ({
  parseSoftProDate: () => null,
}));

vi.mock('@/lib/integrations/softpro', () => ({
  getOrderDetails: getOrderDetailsMock,
}));

// Relative importActual so Vitest resolves the real module (alias @/ fails under mocks).
vi.mock('@/lib/domain/orders/process-detail', async () => {
  return vi.importActual<typeof import('../../domain/orders/process-detail')>(
    '../../domain/orders/process-detail',
  );
});

vi.mock('@/lib/db/client', () => ({
  db: {
    selectDistinct: vi.fn(() => ({
      from: vi.fn(() => ({
        leftJoin: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn(() => ({
              limit: vi.fn(async () => candidates),
            })),
          })),
        })),
      })),
    })),
    select: vi.fn(() => ({
      from: vi.fn((table: { __table?: string }) => {
        if (table.__table === 'orders') {
          return {
            where: vi.fn(() => ({
              limit: vi.fn(async () => existingOrderRows),
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
        // Officer loaders
        return {
          where: vi.fn(async () => []),
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

import { handleEnrichOrderDetails } from './enrich-order-details';

function softProDetail(overrides: Record<string, string> = {}) {
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

function lastOrderFieldUpdate(): Record<string, unknown> {
  // Stamp update has lastDetailsFetchAt; processOrderDetail sets softproLastSyncedAt.
  const detailUpdate = [...orderUpdateSets]
    .reverse()
    .find((set) => 'softproLastSyncedAt' in set || 'productType' in set || 'transactionType' in set);
  if (!detailUpdate) {
    throw new Error(`Expected processOrderDetail update; got ${JSON.stringify(orderUpdateSets)}`);
  }
  return detailUpdate;
}

describe('handleEnrichOrderDetails preserveExistingOnEmpty', () => {
  beforeEach(() => {
    orderUpdateSets.length = 0;
    getOrderDetailsMock.mockReset();
  });

  it('preserves existing type fields when SoftPro returns empty strings', async () => {
    getOrderDetailsMock.mockResolvedValue({
      success: true,
      data: [softProDetail()],
    });

    const result = await handleEnrichOrderDetails();

    expect(result.enriched).toBe(1);
    expect(getOrderDetailsMock).toHaveBeenCalledWith({
      dateFrom: '',
      orderNumber: '20018881-OCT',
      orderId: 42,
    });

    const set = lastOrderFieldUpdate();
    expect(set.productType).toBeUndefined();
    expect(set.orderType).toBeUndefined();
    expect(set.transactionType).toBeUndefined();
    expect(set.marketingSource).toBeUndefined();
    expect(set).not.toHaveProperty('softproStatus');
    expect(set).not.toHaveProperty('operationalStatus');
  });

  it('fills type fields when SoftPro provides values', async () => {
    getOrderDetailsMock.mockResolvedValue({
      success: true,
      data: [
        softProDetail({
          OrderStatus: 'In Process',
          ProductType: 'Owner Policy',
          OrderType: 'Purchase',
          TransactionType: 'Refinance',
          MarketingSource: 'Referral',
        }),
      ],
    });

    const result = await handleEnrichOrderDetails();

    expect(result.enriched).toBe(1);
    const set = lastOrderFieldUpdate();
    expect(set.productType).toBe('Owner Policy');
    expect(set.orderType).toBe('Purchase');
    expect(set.transactionType).toBe('Refinance');
    expect(set.marketingSource).toBe('Referral');
    expect(set.operationalStatus).toBe('in_process');
  });
});
