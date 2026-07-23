import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  getRepFiguresMock,
  getScopedOrdersMock,
  getSessionMock,
  validateSalesAccessMock,
  dbBuilder,
  dbMock,
} = vi.hoisted(() => {
  // where() is thenable (prelim selectDistinct) AND has .limit() (home-branch select)
  const makeWhereResult = (rows: unknown[], limitRows: unknown[]) => {
    const result: {
      limit: ReturnType<typeof vi.fn>;
      then: Promise<unknown[]>['then'];
    } = {
      limit: vi.fn(async () => limitRows),
      then(onFulfilled, onRejected) {
        return Promise.resolve(rows).then(onFulfilled, onRejected);
      },
    };
    return result;
  };

  const dbBuilder = {
    from: vi.fn(() => dbBuilder),
    where: vi.fn(() => makeWhereResult([], [{ code: 'GLT' }])),
    limit: vi.fn(async () => [{ code: 'GLT' }]),
    makeWhereResult,
  };

  return {
    getRepFiguresMock: vi.fn(),
    getScopedOrdersMock: vi.fn(),
    getSessionMock: vi.fn(),
    validateSalesAccessMock: vi.fn(),
    dbBuilder,
    dbMock: {
      selectDistinct: vi.fn(() => dbBuilder),
      select: vi.fn(() => dbBuilder),
    },
  };
});

vi.mock('@/lib/security/auth', () => ({
  getSession: getSessionMock,
}));

vi.mock('@/lib/domain/orders/scoped-queries', () => ({
  getScopedOrders: getScopedOrdersMock,
}));

vi.mock('@/lib/integrations/managers-report', () => ({
  getRepFigures: getRepFiguresMock,
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
  branches: {
    id: 'branches.id',
    code: 'branches.code',
  },
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions) => ({ type: 'and', conditions })),
  eq: vi.fn((left, right) => ({ type: 'eq', left, right })),
  inArray: vi.fn((left, values) => ({ type: 'inArray', left, values })),
}));

import { GET } from './route';

describe('GET /api/sales/dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({
      id: 'manager-1',
      role: 'sales_manager',
      contactId: 10,
      branchId: 1,
    });
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
    getRepFiguresMock.mockResolvedValue({ success: false, data: null });
    dbBuilder.where.mockImplementation(() =>
      dbBuilder.makeWhereResult([], [{ code: 'GLT' }]),
    );
  });

  it('passes a sales manager team scope to dashboard orders', async () => {
    const response = await GET(new NextRequest('http://localhost/api/sales/dashboard'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(getScopedOrdersMock).toHaveBeenCalledWith(expect.objectContaining({
      contactId: 10,
      contactIds: [10, 20],
    }));
    expect(body.orders).toEqual([
      { id: 123, fileNumber: '20012345-OCT', salesRepName: 'Team Rep', hasPrelim: false },
    ]);
    expect(body.homeBranchCode).toBe('GLT');
    expect(body.mtd).toBeNull();
  });

  it('maps productionByBranch and leaves mtd.revenue unchanged', async () => {
    getSessionMock.mockResolvedValue({
      id: 'manager-1',
      role: 'sales_manager',
      contactId: 10,
      branchId: 2,
    });
    dbBuilder.where.mockImplementation(() =>
      dbBuilder.makeWhereResult([], [{ code: 'OCT' }]),
    );

    getRepFiguresMock.mockResolvedValue({
      success: true,
      data: {
        rep: 'Richard Bohn',
        month: '2026-06',
        yesterday: { date: '2026-06-08', closed: 1, revenue: 500, opens: 0 },
        mtd: {
          closed: 15,
          revenue: 40397,
          opens: 20,
          purchase: 10,
          refinance: 5,
          escrow: 0,
          tsg: 0,
          repTotalProduction: 40397,
          titleRevenue: 40397,
          commissionableEscrow: 0,
          tsgRevenue: 0,
          repProductionByDealType: { purchase: 30000, refinance: 10397, other: 0 },
          productionByBranch: {
            Glendale: { closed: 2, revenue: 2125 },
            Orange: { closed: 12, revenue: 32015 },
            'Inland Empire': { closed: 1, revenue: 6257 },
            Porterville: { closed: 0, revenue: 0 },
            TSG: { closed: 0, revenue: 0 },
            Unassigned: { closed: 0, revenue: 0 },
          },
        },
        prior: { month: '2026-05', closed: 10, revenue: 20000 },
        projected: 50000,
        closingRatio: { created: 20, closed: 15, ratio: 0.75, window: '90d' },
        ranking: { position: 2, totalReps: 12 },
        workingDays: { worked: 10, total: 22, remaining: 12 },
      },
    });

    const response = await GET(new NextRequest('http://localhost/api/sales/dashboard'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.mtd.revenue).toBe(40397);
    expect(body.productionByBranch).toEqual({
      available: true,
      locations: {
        GLT: { closed: 2, revenue: 2125 },
        OCT: { closed: 12, revenue: 32015 },
        ONT: { closed: 1, revenue: 6257 },
        PRV: { closed: 0, revenue: 0 },
      },
      tsg: { closed: 0, revenue: 0 },
      unassigned: { closed: 0, revenue: 0 },
    });
    expect(body.homeBranchCode).toBe('OCT');
    expect(body.yesterday).toEqual({ closed: 1, revenue: 500, opens: 0 });
  });

  it('NULL branch_id → homeBranchCode null (neutral degrade, no crash)', async () => {
    getSessionMock.mockResolvedValue({
      id: 'manager-1',
      role: 'sales_manager',
      contactId: 10,
      branchId: null,
    });

    const response = await GET(new NextRequest('http://localhost/api/sales/dashboard'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.homeBranchCode).toBeNull();
  });
});
