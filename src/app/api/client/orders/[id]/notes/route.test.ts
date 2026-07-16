import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  canAccessOrderMock,
  getSessionMock,
  selectMock,
  whereMock,
} = vi.hoisted(() => ({
  canAccessOrderMock: vi.fn(),
  getSessionMock: vi.fn(),
  selectMock: vi.fn(),
  whereMock: vi.fn(),
}));

vi.mock('@/lib/security/auth', () => ({
  getSession: getSessionMock,
}));

vi.mock('@/lib/security/client-scope', () => ({
  canAccessOrder: canAccessOrderMock,
}));

vi.mock('@/lib/integrations/softpro', () => ({
  addNotes: vi.fn(),
}));

vi.mock('@/lib/db/schema', () => ({
  orders: { id: 'orders.id', fileNumber: 'orders.file_number' },
  orderNotes: {
    id: 'order_notes.id',
    subject: 'order_notes.subject',
    body: 'order_notes.body',
    authorName: 'order_notes.author_name',
    createdAt: 'order_notes.created_at',
    isSyncedToSoftpro: 'order_notes.is_synced',
    isInternal: 'order_notes.is_internal',
    orderId: 'order_notes.order_id',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args) => ({ eq: args })),
  and: vi.fn((...args) => ({ and: args })),
  desc: vi.fn((v) => v),
}));

vi.mock('@/lib/db/client', () => {
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn(() => chain);
  chain.where = whereMock.mockImplementation(() => chain);
  chain.orderBy = vi.fn(async () => [
    {
      id: 2,
      subject: 'Client visible',
      body: 'Shared note',
      authorName: 'Client',
      createdAt: new Date('2026-01-02'),
      isSyncedToSoftpro: false,
    },
  ]);
  chain.limit = vi.fn(async () => [{ fileNumber: '20012345-OCT' }]);
  return {
    db: {
      select: selectMock.mockImplementation(() => chain),
      insert: vi.fn(),
      update: vi.fn(),
    },
  };
});

import { GET } from './route';

describe('GET /api/client/orders/[id]/notes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ id: 'client-1', email: 'client@example.com', role: 'client' });
    canAccessOrderMock.mockResolvedValue(true);
  });

  it('returns only non-internal notes for clients', async () => {
    const res = await GET(new NextRequest('http://localhost/api/client/orders/123/notes'), {
      params: Promise.resolve({ id: '123' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.notes).toHaveLength(1);
    expect(body.notes[0].body).toBe('Shared note');

    // Proof: client query filters is_internal = false
    const { and, eq } = await import('drizzle-orm');
    expect(and).toHaveBeenCalled();
    expect(eq).toHaveBeenCalledWith('order_notes.is_internal', false);
    expect(eq).toHaveBeenCalledWith('order_notes.order_id', 123);
  });

  it('does not return notes when client lacks order access', async () => {
    canAccessOrderMock.mockResolvedValue(false);
    const res = await GET(new NextRequest('http://localhost/api/client/orders/123/notes'), {
      params: Promise.resolve({ id: '123' }),
    });
    expect(res.status).toBe(404);
    expect(selectMock).not.toHaveBeenCalled();
  });
});
