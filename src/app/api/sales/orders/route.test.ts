import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  getScopedOrdersMock,
  getSessionMock,
  validateSalesAccessMock,
  dbBuilder,
  dbMock,
} = vi.hoisted(() => {
  const dbBuilder = {
    from: vi.fn(() => dbBuilder),
    where: vi.fn(async () => []),
  };

  return {
    getScopedOrdersMock: vi.fn(),
    getSessionMock: vi.fn(),
    validateSalesAccessMock: vi.fn(),
    dbBuilder,
    dbMock: {
      selectDistinct: vi.fn(() => dbBuilder),
    },
  };
});

vi.mock('@/lib/security/auth', () => ({
  getSession: getSessionMock,
}));

vi.mock('@/lib/domain/orders/scoped-queries', () => ({
  getScopedOrders: getScopedOrdersMock,
}));

vi.mock('../_helpers/validate-access', () => ({
  SalesAccessError: class SalesAccessError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
  validateSalesAccess: validateSalesAccessMock,
}));

vi.mock('@/lib/db/client', () => ({
  db: dbMock,
}));

vi.mock('@/lib/db/schema', () => ({
  documents: {
    orderId: 'documents.order_id',
    category: 'documents.category',
    status: 'documents.status',
  },
  orders: {
    salesRepId: 'orders.sales_rep_id',
  },
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions) => ({ type: 'and', conditions })),
  eq: vi.fn((left, right) => ({ type: 'eq', left, right })),
  inArray: vi.fn((left, values) => ({ type: 'inArray', left, values })),
}));

vi.mock('@/lib/utils/month-range', () => ({
  getMonthRange: vi.fn(() => null),
}));

import { GET } from './route';

describe('GET /api/sales/orders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ id: 'manager-1', role: 'sales_manager', contactId: 10 });
    validateSalesAccessMock.mockResolvedValue({
      contactId: 10,
      contactIds: [10, 20],
      repName: 'Manager User',
      role: 'sales_manager',
    });
    getScopedOrdersMock.mockResolvedValue({
      orders: [{ id: 123, fileNumber: '20012345-OCT', salesRepName: 'Team Rep' }],
      total: 1,
      page: 1,
      pageSize: 25,
    });
    dbBuilder.where.mockResolvedValue([]);
  });

  it('passes a sales manager team scope to the scoped order list', async () => {
    const response = await GET(new NextRequest('http://localhost/api/sales/orders'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(getScopedOrdersMock).toHaveBeenCalledWith(expect.objectContaining({
      contactId: 10,
      contactIds: [10, 20],
    }));
    expect(body.orders).toEqual([
      { id: 123, fileNumber: '20012345-OCT', salesRepName: 'Team Rep', hasPrelim: false },
    ]);
  });
});
