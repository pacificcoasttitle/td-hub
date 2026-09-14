import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Two order reads that answered any logged-in session across every order until
// 2026-09-14. Each must now apply the orders list's row-level scope. Asserted by
// what reaches the query: the scope predicate the helper returned for this
// session must be inside the WHERE clause — not "a WHERE exists".

const { getSessionMock, buildScopeFilterMock, whereArgs } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  buildScopeFilterMock: vi.fn(),
  whereArgs: [] as unknown[],
}));

vi.mock('@/lib/security/auth', () => ({ getSession: getSessionMock }));
vi.mock('@/lib/domain/orders/scope', () => ({ buildScopeFilter: buildScopeFilterMock }));
vi.mock('@/lib/domain/orders/lookback-diff', () => ({ LOOKBACK_STATUS_SOURCE: 'lookback_sync' }));
vi.mock('@/lib/db/schema', () => ({
  orders: { id: 'orders.id', fileNumber: 'orders.file_number', openedAt: 'orders.opened_at', operationalStatus: 'orders.status' },
  orderProperties: { orderId: 'op.order_id', address: 'op.address', city: 'op.city', state: 'op.state' },
  orderStatusHistory: {
    id: 'h.id', orderId: 'h.order_id', status: 'h.status', source: 'h.source', notes: 'h.notes', changedAt: 'h.changed_at',
  },
}));
// Operators return inspectable trees so the test can find the scope predicate.
vi.mock('drizzle-orm', () => ({
  and: (...parts: unknown[]) => ({ op: 'and', parts }),
  or: (...parts: unknown[]) => ({ op: 'or', parts }),
  eq: (...parts: unknown[]) => ({ op: 'eq', parts }),
  ne: (...parts: unknown[]) => ({ op: 'ne', parts }),
  ilike: (...parts: unknown[]) => ({ op: 'ilike', parts }),
  desc: (c: unknown) => ({ op: 'desc', c }),
}));
vi.mock('@/lib/db/client', () => {
  const chain: Record<string, unknown> = {};
  for (const m of ['from', 'leftJoin', 'innerJoin', 'orderBy']) chain[m] = () => chain;
  chain.where = (arg: unknown) => { whereArgs.push(arg); return chain; };
  chain.limit = async () => [];
  return { db: { select: () => chain } };
});

import { GET as quickSearch } from './quick-search/route';

function contains(tree: unknown, needle: unknown): boolean {
  if (tree === needle) return true;
  if (!tree || typeof tree !== 'object') return false;
  return Object.values(tree as Record<string, unknown>).some((v) =>
    Array.isArray(v) ? v.some((x) => contains(x, needle)) : contains(v, needle));
}

const READS: Array<[string, () => Promise<Response>]> = [
  ['GET /api/orders/quick-search', () => quickSearch(new NextRequest('http://localhost/api/orders/quick-search?q=2002'))],
];

describe.each(READS)('%s is scoped like the orders list', (_name, call) => {
  beforeEach(() => {
    getSessionMock.mockReset();
    buildScopeFilterMock.mockReset();
    whereArgs.length = 0;
  });

  it('puts the client scope into the query — a client sees only its own orders', async () => {
    const session = { id: 'client-1', role: 'client', contactId: 9, email: 'c@example.com' };
    const clientScope = { op: 'eq', parts: ['orders.created_by', 'client-1'] };
    getSessionMock.mockResolvedValue(session);
    buildScopeFilterMock.mockResolvedValue(clientScope);

    const res = await call();

    expect(res.status).toBe(200);
    expect(buildScopeFilterMock).toHaveBeenCalledWith(session);
    expect(whereArgs).toHaveLength(1);
    expect(contains(whereArgs[0], clientScope)).toBe(true);
  });

  it('applies whatever scope a sales rep gets, not all orders', async () => {
    const repScope = { op: 'eq', parts: ['orders.sales_rep_id', 22133] };
    getSessionMock.mockResolvedValue({ id: 'rep-1', role: 'sales_rep', contactId: 22133, email: 'r@pct.com' });
    buildScopeFilterMock.mockResolvedValue(repScope);

    await call();

    expect(contains(whereArgs[0], repScope)).toBe(true);
  });

  it('adds no restriction for a full-access role (helper returns null)', async () => {
    getSessionMock.mockResolvedValue({ id: 'a-1', role: 'admin', contactId: null, email: 'a@pct.com' });
    buildScopeFilterMock.mockResolvedValue(null);

    const res = await call();

    expect(res.status).toBe(200);
    expect(whereArgs).toHaveLength(1);
  });

  it('refuses no session before any query', async () => {
    getSessionMock.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
    expect(whereArgs).toHaveLength(0);
  });
});
