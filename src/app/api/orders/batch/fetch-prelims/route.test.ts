import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  canAccessOrderDetailResourceMock,
  dbBuilder,
  fetchPrelimsForOrderMock,
  getSessionMock,
} = vi.hoisted(() => ({
  canAccessOrderDetailResourceMock: vi.fn(),
  dbBuilder: {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  },
  fetchPrelimsForOrderMock: vi.fn(),
  getSessionMock: vi.fn(),
}));

vi.mock('@/lib/security/auth', () => ({
  getSession: getSessionMock,
}));

vi.mock('@/lib/security/permissions', () => ({
  canAccessOrderDetailResource: canAccessOrderDetailResourceMock,
}));

vi.mock('@/lib/jobs/handlers/fetch-prelims', () => ({
  fetchPrelimsForOrder: fetchPrelimsForOrderMock,
}));

vi.mock('@/lib/db/client', () => ({
  db: {
    select: vi.fn(() => dbBuilder),
  },
}));

vi.mock('@/lib/db/schema', () => ({
  orders: {
    id: 'orders.id',
    fileNumber: 'orders.fileNumber',
    orderType: 'orders.orderType',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((left, right) => ({ left, right })),
}));

import { POST } from './route';

function request(body: unknown) {
  return new NextRequest('http://localhost/api/orders/batch/fetch-prelims', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('POST /api/orders/batch/fetch-prelims ACL', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getSessionMock.mockResolvedValue({ id: 'mgr-1', role: 'sales_manager', contactId: 10 });
    canAccessOrderDetailResourceMock.mockResolvedValue(true);
    dbBuilder.from.mockReturnValue(dbBuilder);
    dbBuilder.where.mockReturnValue(dbBuilder);
  });

  it('skips orderIds the caller cannot access and never fetches them', async () => {
    canAccessOrderDetailResourceMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    dbBuilder.limit.mockResolvedValue([{ fileNumber: '20012345-OCT', orderType: 'Title only' }]);
    fetchPrelimsForOrderMock.mockResolvedValue(2);

    const response = await POST(request({ orderIds: [11, 99] }));
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
    expect(fetchPrelimsForOrderMock).toHaveBeenCalledTimes(1);
    expect(fetchPrelimsForOrderMock).toHaveBeenCalledWith(11, '20012345-OCT', 'Title only');
    expect(body.results).toEqual([
      { orderId: 11, success: true, documentsFound: 2 },
      { orderId: 99, success: false, documentsFound: 0, error: 'Not found' },
    ]);
  });

  it('processes all ids when caller has access', async () => {
    dbBuilder.limit
      .mockResolvedValueOnce([{ fileNumber: 'A', orderType: 'Title & Escrow' }])
      .mockResolvedValueOnce([{ fileNumber: 'B', orderType: 'Title only' }]);
    fetchPrelimsForOrderMock
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);

    const response = await POST(request({ orderIds: [11, 22] }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(fetchPrelimsForOrderMock).toHaveBeenCalledTimes(2);
    expect(body.results).toEqual([
      { orderId: 11, success: true, documentsFound: 1 },
      { orderId: 22, success: true, documentsFound: 0 },
    ]);
  });
});
