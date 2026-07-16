import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  canAccessOrderMock,
  canAccessSalesScopedOrderMock,
  dbMock,
  getSessionMock,
  query,
} = vi.hoisted(() => {
  const query = {
    limitRows: [] as unknown[][],
    groupByRows: [] as unknown[][],
    orderByRows: [] as unknown[][],
  };

  const builder = {
    from: vi.fn(() => builder),
    leftJoin: vi.fn(() => builder),
    where: vi.fn(() => builder),
    orderBy: vi.fn(async () => query.orderByRows.shift() ?? []),
    groupBy: vi.fn(async () => query.groupByRows.shift() ?? []),
    limit: vi.fn(async () => query.limitRows.shift() ?? []),
  };

  return {
    canAccessOrderMock: vi.fn(),
    canAccessSalesScopedOrderMock: vi.fn(),
    getSessionMock: vi.fn(),
    query,
    dbMock: {
      select: vi.fn(() => builder),
    },
  };
});

vi.mock('@/lib/security/auth', () => ({
  getSession: getSessionMock,
}));

vi.mock('@/lib/security/permissions', () => ({
  canAccessOrder: canAccessOrderMock,
  canAccessSalesScopedOrder: canAccessSalesScopedOrderMock,
  isSalesScopedRole: (role: string) => role === 'sales_rep' || role === 'sales_manager',
}));

vi.mock('@/lib/db/client', () => ({
  db: dbMock,
}));

vi.mock('@/lib/db/schema', () => {
  const table = (name: string) => new Proxy({}, {
    get: (_target, prop) => `${name}.${String(prop)}`,
  });

  return {
    documents: table('documents'),
    orderParties: table('order_parties'),
    orderProperties: table('order_properties'),
    orders: table('orders'),
    orderStatusHistory: table('order_status_history'),
  };
});

vi.mock('@/lib/domain/orders/detail-helpers', () => {
  const table = (name: string) => new Proxy({}, {
    get: (_target, prop) => `${name}.${String(prop)}`,
  });

  return {
    contactDisplayName: vi.fn(() => 'Contact Name'),
    createdByProfile: table('created_by_profile'),
    escrowOfficerContact: table('escrow_officer'),
    formatParty: vi.fn(() => null),
    lenderContact: table('lender_contact'),
    listingAgentContact: table('listing_agent'),
    salesRepContact: table('sales_rep'),
    titleCompanyAlias: table('title_company'),
    titleOfficerContact: table('title_officer'),
    underwriterAlias: table('underwriter_company'),
  };
});

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions) => ({ type: 'and', conditions })),
  asc: vi.fn((column) => ({ type: 'asc', column })),
  eq: vi.fn((left, right) => ({ type: 'eq', left, right })),
  sql: vi.fn((strings, ...values) => ({ type: 'sql', strings, values })),
}));

import { GET } from './route';

function detailRow() {
  const now = new Date('2026-07-15T12:00:00.000Z');
  return {
    id: 123,
    fileNumber: '20012345-OCT',
    operationalStatus: 'open',
    source: null,
    productType: null,
    transactionType: null,
    salesPrice: null,
    loanAmount: null,
    openedAt: now,
    closedAt: null,
    marketingSource: null,
    emailStatus: null,
    dupOverride: false,
    createdAt: now,
    updatedAt: now,
    propAddress: '123 Main St',
    propCity: 'Orange',
    propState: 'CA',
    propZip: '92868',
    propCounty: null,
    propApn: null,
    propLegalDesc: null,
    propType: null,
    eoId: null,
    tcId: null,
    tcName: null,
    uwId: null,
    uwName: null,
    srId: null,
    toId: null,
    cbId: null,
  };
}

describe('GET /api/admin/orders/[id]/detail sales scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    query.limitRows = [];
    query.groupByRows = [];
    query.orderByRows = [];
    getSessionMock.mockResolvedValue({ id: 'manager-1', role: 'sales_manager', contactId: 10 });
    canAccessOrderMock.mockResolvedValue(false);
    canAccessSalesScopedOrderMock.mockResolvedValue(true);
  });

  it('uses the sales-scoped predicate for sales manager detail access', async () => {
    query.limitRows.push([detailRow()]);
    query.orderByRows.push([]);
    query.groupByRows.push([]);
    query.orderByRows.push([]);

    const response = await GET({} as never, { params: Promise.resolve({ id: '123' }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.order.fileNumber).toBe('20012345-OCT');
    expect(canAccessSalesScopedOrderMock).toHaveBeenCalledWith(
      { id: 'manager-1', role: 'sales_manager', contactId: 10 },
      123,
    );
    expect(canAccessOrderMock).not.toHaveBeenCalled();
  });
});
