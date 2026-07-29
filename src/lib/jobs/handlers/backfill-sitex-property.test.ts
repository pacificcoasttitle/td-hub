import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  propertyLookupMock,
  applySiteXMock,
  orderUpdateSets,
  candidates,
} = vi.hoisted(() => ({
  propertyLookupMock: vi.fn(),
  applySiteXMock: vi.fn(),
  orderUpdateSets: [] as Array<Record<string, unknown>>,
  candidates: [{
    id: 99,
    fileNumber: '20018881-OCT',
    address: '123 Main St',
    city: 'Glendale',
    state: 'CA',
    zip: '91203',
    lastSitexFetchAt: null as Date | null,
  }],
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
    lastSitexFetchAt: 'orders.last_sitex_fetch_at',
    sitexAttemptCount: 'orders.sitex_attempt_count',
    updatedAt: 'orders.updated_at',
  },
  orderProperties: {
    __table: 'order_properties',
    orderId: 'order_properties.order_id',
    address: 'order_properties.address',
    city: 'order_properties.city',
    state: 'order_properties.state',
    zip: 'order_properties.zip',
    apn: 'order_properties.apn',
    legalDescription: 'order_properties.legal_description',
    propertyType: 'order_properties.property_type',
  },
}));

vi.mock('@/lib/integrations/sitex/client', () => ({
  propertyLookup: propertyLookupMock,
}));

vi.mock('@/lib/domain/orders/apply-sitex-property', () => ({
  applySiteXPropertyFields: applySiteXMock,
}));

vi.mock('@/lib/db/client', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        innerJoin: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn(() => ({
              limit: vi.fn(async () => candidates),
            })),
          })),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => {
        orderUpdateSets.push(values);
        return { where: vi.fn(async () => undefined) };
      }),
    })),
  },
}));

import { handleBackfillSitexProperty } from './backfill-sitex-property';

describe('handleBackfillSitexProperty', () => {
  beforeEach(() => {
    orderUpdateSets.length = 0;
    propertyLookupMock.mockReset();
    applySiteXMock.mockReset();
  });

  it('looks up SiteX and applies fill-only parcel fields', async () => {
    propertyLookupMock.mockResolvedValue({
      success: true,
      data: {
        matchCode: 'S',
        apn: '8321-027-034',
        legalDescription: 'LOT 34',
        propertyType: 'Single Family Residence',
        zip: '91203',
      },
    });
    applySiteXMock.mockResolvedValue({
      applied: true,
      fieldsFilled: ['apn', 'legalDescription', 'propertyType'],
    });

    const result = await handleBackfillSitexProperty();

    expect(result.attempted).toBe(1);
    expect(result.filled).toBe(1);
    expect(propertyLookupMock).toHaveBeenCalledWith({
      street: '123 Main St',
      city: 'Glendale',
      state: 'CA',
      zip: '91203',
    });
    expect(applySiteXMock).toHaveBeenCalledWith(99, expect.objectContaining({ matchCode: 'S' }));
    expect(orderUpdateSets[0]).toHaveProperty('lastSitexFetchAt');
    expect(orderUpdateSets[0]).toHaveProperty('sitexAttemptCount');
  });

  it('counts noMatch without applying when SiteX is not a single match', async () => {
    propertyLookupMock.mockResolvedValue({
      success: true,
      data: { matchCode: 'N' },
    });

    const result = await handleBackfillSitexProperty();

    expect(result.noMatch).toBe(1);
    expect(result.filled).toBe(0);
    expect(applySiteXMock).not.toHaveBeenCalled();
  });
});
