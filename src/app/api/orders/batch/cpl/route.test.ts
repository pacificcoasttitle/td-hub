import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  canAccessOrderDetailResourceMock,
  dbBuilder,
  generateCplMock,
  getSessionMock,
} = vi.hoisted(() => ({
  canAccessOrderDetailResourceMock: vi.fn(),
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

vi.mock('@/lib/security/permissions', () => ({
  canAccessOrderDetailResource: canAccessOrderDetailResourceMock,
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
    vi.resetAllMocks();
    getSessionMock.mockResolvedValue({ id: 'staff-1', role: 'admin', contactId: null });
    canAccessOrderDetailResourceMock.mockResolvedValue(true);
    dbBuilder.from.mockReturnValue(dbBuilder);
    dbBuilder.where.mockReturnValue(dbBuilder);
  });

  it('processes mixed-branch orders using each order branch with per-order status', async () => {
    dbBuilder.limit
      .mockResolvedValueOnce([{ branchId: 2 }])
      .mockResolvedValueOnce([{ branchId: 7 }]);
    generateCplMock
      .mockResolvedValueOnce({ success: true, documentId: 101, errors: [] })
      .mockResolvedValueOnce({ success: false, documentId: undefined, errors: ['Missing lender'] });

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

  it('skips orderIds the caller cannot access and never generates CPL for them', async () => {
    getSessionMock.mockResolvedValue({ id: 'mgr-1', role: 'sales_manager', contactId: 10 });
    canAccessOrderDetailResourceMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    dbBuilder.limit.mockResolvedValueOnce([{ branchId: 2 }]);
    generateCplMock.mockResolvedValueOnce({ success: true, documentId: 101, errors: [] });

    const response = await POST(request({
      orderIds: [11, 99],
      underwriter: 'westcor',
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(canAccessOrderDetailResourceMock).toHaveBeenNthCalledWith(
      1,
      { id: 'mgr-1', role: 'sales_manager', contactId: 10 },
      11,
    );
    expect(canAccessOrderDetailResourceMock).toHaveBeenNthCalledWith(
      2,
      { id: 'mgr-1', role: 'sales_manager', contactId: 10 },
      99,
    );
    expect(generateCplMock).toHaveBeenCalledTimes(1);
    expect(generateCplMock).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 11 }),
      'mgr-1',
    );
    expect(body.results).toEqual([
      { orderId: 11, success: true, documentId: 101 },
      { orderId: 99, success: false, error: 'Not found' },
    ]);
  });

  it('does not rely on role allowlist alone — sales_rep with access can process own order', async () => {
    getSessionMock.mockResolvedValue({ id: 'rep-1', role: 'sales_rep', contactId: 3 });
    canAccessOrderDetailResourceMock.mockResolvedValue(true);
    dbBuilder.limit.mockResolvedValueOnce([{ branchId: 2 }]);
    generateCplMock.mockResolvedValueOnce({ success: true, documentId: 55, errors: [] });

    const response = await POST(request({
      orderIds: [11],
      underwriter: 'westcor',
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.results).toEqual([{ orderId: 11, success: true, documentId: 55 }]);
    expect(generateCplMock).toHaveBeenCalledTimes(1);
  });
});
