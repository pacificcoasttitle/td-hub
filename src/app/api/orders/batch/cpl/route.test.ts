import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { dbBuilder, generateCplMock, getSessionMock } = vi.hoisted(() => ({
  dbBuilder: {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  },
  generateCplMock: vi.fn(),
  getSessionMock: vi.fn(),
}));

vi.mock('@/lib/security/auth', () => ({
  getSession: getSessionMock,
}));

vi.mock('@/lib/domain/cpl/service', () => ({
  generateCpl: generateCplMock,
}));

vi.mock('@/lib/db/client', () => ({
  db: {
    select: vi.fn(() => dbBuilder),
  },
}));

vi.mock('@/lib/db/schema', () => ({
  orders: {
    id: 'orders.id',
    branchId: 'orders.branchId',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((left, right) => ({ left, right })),
}));

import { POST } from './route';

function request(body: unknown) {
  return new NextRequest('http://localhost/api/orders/batch/cpl', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('POST /api/orders/batch/cpl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ id: 'staff-1', role: 'admin' });
    dbBuilder.from.mockReturnValue(dbBuilder);
    dbBuilder.where.mockReturnValue(dbBuilder);
    dbBuilder.limit
      .mockResolvedValueOnce([{ branchId: 2 }])
      .mockResolvedValueOnce([{ branchId: 7 }]);
    generateCplMock
      .mockResolvedValueOnce({ success: true, documentId: 101, errors: [] })
      .mockResolvedValueOnce({ success: false, documentId: undefined, errors: ['Missing lender'] });
  });

  it('processes mixed-branch orders using each order branch with per-order status', async () => {
    const response = await POST(request({
      orderIds: [11, 22],
      underwriter: 'westcor',
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(generateCplMock).toHaveBeenNthCalledWith(1, {
      orderId: 11,
      underwriter: 'westcor',
      branchId: 2,
      cplMode: undefined,
      lenderOverrides: undefined,
    }, 'staff-1');
    expect(generateCplMock).toHaveBeenNthCalledWith(2, {
      orderId: 22,
      underwriter: 'westcor',
      branchId: 7,
      cplMode: undefined,
      lenderOverrides: undefined,
    }, 'staff-1');
    expect(body.results).toEqual([
      { orderId: 11, success: true, documentId: 101 },
      { orderId: 22, success: false, error: 'Missing lender' },
    ]);
  });
});
