import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock, getManagedRepIdsMock, query } = vi.hoisted(() => {
  const query = {
    rows: [] as unknown[][],
  };

  const builder = {
    from: vi.fn(() => builder),
    where: vi.fn(() => builder),
    limit: vi.fn(async () => query.rows.shift() ?? []),
  };

  const dbMock = {
    select: vi.fn(() => builder),
  };

  return {
    dbMock,
    getManagedRepIdsMock: vi.fn(),
    query,
  };
});

vi.mock('@/lib/db/client', () => ({
  db: dbMock,
}));

vi.mock('@/lib/db/schema', () => ({
  orders: {
    id: 'orders.id',
    salesRepId: 'orders.sales_rep_id',
  },
}));

vi.mock('@/lib/domain/contacts/managed-reps', () => ({
  getManagedRepIds: getManagedRepIdsMock,
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions) => ({ type: 'and', conditions })),
  eq: vi.fn((left, right) => ({ type: 'eq', left, right })),
  inArray: vi.fn((left, values) => ({ type: 'inArray', left, values })),
}));

import {
  canAccessOrderDetailResource,
  canAccessSalesScopedOrder,
  getSalesScopedContactIds,
} from './permissions';
import type { SessionUser } from './auth';

function session(role: string, contactId: number | null): SessionUser {
  return {
    id: 'user-1',
    email: 'user@example.com',
    role,
    displayName: 'User',
    branchId: null,
    contactId,
  };
}

describe('sales-scoped order permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    query.rows = [];
    getManagedRepIdsMock.mockResolvedValue([]);
  });

  it('scopes a sales manager to their own contact plus managed sales reps', async () => {
    getManagedRepIdsMock.mockResolvedValueOnce([20, 30, 20]);

    await expect(getSalesScopedContactIds(session('sales_manager', 10))).resolves.toEqual([10, 20, 30]);
    expect(getManagedRepIdsMock).toHaveBeenCalledWith(10);
  });

  it('scopes a sales rep only to their own contact', async () => {
    await expect(getSalesScopedContactIds(session('sales_rep', 10))).resolves.toEqual([10]);
    expect(getManagedRepIdsMock).not.toHaveBeenCalled();
  });

  it('allows a sales manager order when the scoped sales-rep predicate matches', async () => {
    getManagedRepIdsMock.mockResolvedValueOnce([20]);
    query.rows.push([{ id: 123 }]);

    await expect(canAccessSalesScopedOrder(session('sales_manager', 10), 123)).resolves.toBe(true);
    expect(dbMock.select).toHaveBeenCalledTimes(1);
  });

  it('does not grant access to non-sales roles or unlinked sales users', async () => {
    await expect(canAccessSalesScopedOrder(session('admin', 10), 123)).resolves.toBe(false);
    await expect(canAccessSalesScopedOrder(session('sales_rep', null), 123)).resolves.toBe(false);
    expect(dbMock.select).not.toHaveBeenCalled();
  });

  it('does not let a sales rep access a non-owned order', async () => {
    query.rows.push([]);

    await expect(canAccessSalesScopedOrder(session('sales_rep', 10), 999)).resolves.toBe(false);
    expect(getManagedRepIdsMock).not.toHaveBeenCalled();
  });
});

describe('canAccessOrderDetailResource (DC-2 tab gate)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    query.rows = [];
    getManagedRepIdsMock.mockResolvedValue([]);
  });

  it('allows a manager to access a direct-report order via sales scope', async () => {
    getManagedRepIdsMock.mockResolvedValueOnce([20]);
    query.rows.push([{ id: 123 }]);

    await expect(canAccessOrderDetailResource(session('sales_manager', 10), 123)).resolves.toBe(true);
    expect(getManagedRepIdsMock).toHaveBeenCalledWith(10);
  });

  it('denies a manager on a non-team order (no over-grant)', async () => {
    getManagedRepIdsMock.mockResolvedValueOnce([20]);
    query.rows.push([]);

    await expect(canAccessOrderDetailResource(session('sales_manager', 10), 999)).resolves.toBe(false);
  });

  it('allows a sales rep only on their own order', async () => {
    query.rows.push([{ id: 55 }]);
    await expect(canAccessOrderDetailResource(session('sales_rep', 10), 55)).resolves.toBe(true);
    expect(getManagedRepIdsMock).not.toHaveBeenCalled();
  });

  it('denies a sales rep on another rep order', async () => {
    query.rows.push([]);
    await expect(canAccessOrderDetailResource(session('sales_rep', 10), 999)).resolves.toBe(false);
    expect(getManagedRepIdsMock).not.toHaveBeenCalled();
  });
});
