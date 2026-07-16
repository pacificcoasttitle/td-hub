import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  canAccessOrderDetailResourceMock,
  getSessionMock,
  insertValuesMock,
  returningMock,
  selectMock,
  whereMock,
} = vi.hoisted(() => ({
  canAccessOrderDetailResourceMock: vi.fn(),
  getSessionMock: vi.fn(),
  insertValuesMock: vi.fn(),
  returningMock: vi.fn(),
  selectMock: vi.fn(),
  whereMock: vi.fn(),
}));

vi.mock('@/lib/security/auth', () => ({
  getSession: getSessionMock,
}));

vi.mock('@/lib/security/permissions', () => ({
  canAccessOrderDetailResource: canAccessOrderDetailResourceMock,
}));

vi.mock('@/lib/integrations/softpro', () => ({
  addNotes: vi.fn(async () => ({ success: false })),
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
  desc: vi.fn((v) => v),
}));

vi.mock('@/lib/db/client', () => {
  const selectChain: Record<string, unknown> = {};
  selectChain.from = vi.fn(() => selectChain);
  selectChain.where = whereMock.mockImplementation(() => selectChain);
  selectChain.orderBy = vi.fn(async () => [
    {
      id: 1,
      subject: 'Staff',
      body: 'Internal note',
      authorName: 'Officer',
      createdAt: new Date('2026-01-01'),
      isSyncedToSoftpro: false,
      isInternal: true,
    },
    {
      id: 2,
      subject: 'Shared',
      body: 'Client note',
      authorName: 'Officer',
      createdAt: new Date('2026-01-02'),
      isSyncedToSoftpro: false,
      isInternal: false,
    },
  ]);
  selectChain.limit = vi.fn(async () => [{ fileNumber: '20012345-OCT' }]);

  returningMock.mockResolvedValue([
    {
      id: 99,
      subject: null,
      body: 'New staff note',
      authorName: 'Officer',
      createdAt: new Date('2026-01-03'),
      isInternal: true,
    },
  ]);

  return {
    db: {
      select: selectMock.mockImplementation(() => selectChain),
      insert: vi.fn(() => ({
        values: (payload: unknown) => {
          insertValuesMock(payload);
          return { returning: () => returningMock() };
        },
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(async () => undefined),
        })),
      })),
    },
  };
});

import { GET, POST } from './route';

describe('staff /api/orders/[id]/notes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({
      id: 'staff-1',
      email: 'staff@pct.com',
      displayName: 'Officer',
      role: 'title_officer',
    });
    canAccessOrderDetailResourceMock.mockResolvedValue(true);
    returningMock.mockResolvedValue([
      {
        id: 99,
        subject: null,
        body: 'New staff note',
        authorName: 'Officer',
        createdAt: new Date('2026-01-03'),
        isInternal: true,
      },
    ]);
  });

  it('GET returns internal and shared notes for staff', async () => {
    const res = await GET(new NextRequest('http://localhost/api/orders/123/notes'), {
      params: Promise.resolve({ id: '123' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.notes).toHaveLength(2);
    expect(body.notes.map((n: { isInternal: boolean }) => n.isInternal)).toEqual([true, false]);

    // Staff filter is order_id only — never is_internal.
    const { eq } = await import('drizzle-orm');
    expect(eq).toHaveBeenCalledWith('order_notes.order_id', 123);
    expect(eq).not.toHaveBeenCalledWith('order_notes.is_internal', expect.anything());
  });

  it('POST defaults staff notes to is_internal = true', async () => {
    const req = new NextRequest('http://localhost/api/orders/123/notes', {
      method: 'POST',
      body: JSON.stringify({ text: 'New staff note' }),
      headers: { 'content-type': 'application/json' },
    });

    const res = await POST(req, { params: Promise.resolve({ id: '123' }) });
    expect(res.status).toBe(201);
    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        body: 'New staff note',
        isInternal: true,
      }),
    );
    const body = await res.json();
    expect(body.note.isInternal).toBe(true);
  });

  it('POST shareWithClient creates a non-internal note', async () => {
    returningMock.mockResolvedValue([
      {
        id: 100,
        subject: null,
        body: 'Shared with client',
        authorName: 'Officer',
        createdAt: new Date('2026-01-03'),
        isInternal: false,
      },
    ]);

    const req = new NextRequest('http://localhost/api/orders/123/notes', {
      method: 'POST',
      body: JSON.stringify({ text: 'Shared with client', shareWithClient: true }),
      headers: { 'content-type': 'application/json' },
    });

    const res = await POST(req, { params: Promise.resolve({ id: '123' }) });
    expect(res.status).toBe(201);
    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        body: 'Shared with client',
        isInternal: false,
      }),
    );
  });
});
