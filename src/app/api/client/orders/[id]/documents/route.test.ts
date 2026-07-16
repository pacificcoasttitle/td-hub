import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  canAccessOrderMock,
  getSessionMock,
  inArrayMock,
  orderByMock,
  whereMock,
} = vi.hoisted(() => ({
  canAccessOrderMock: vi.fn(),
  getSessionMock: vi.fn(),
  inArrayMock: vi.fn((field: unknown, values: unknown[]) => ({ op: 'inArray', field, values })),
  orderByMock: vi.fn(),
  whereMock: vi.fn(),
}));

const MIXED_DOCS = [
  { id: 1, category: 'prelim', filename: 'prelim.pdf' },
  { id: 2, category: 'cpl', filename: 'cpl.pdf' },
  { id: 3, category: 'proposed_insured', filename: 'pi.pdf' },
  { id: 4, category: 'legal_vesting', filename: 'lv.pdf' },
  { id: 5, category: 'tax', filename: 'tax.pdf' },
  { id: 6, category: 'grant_deed', filename: 'deed.pdf' },
  { id: 7, category: 'curative', filename: 'curative.pdf' },
  { id: 8, category: 'general', filename: 'notes.pdf' },
  { id: 9, category: 'user_upload', filename: 'staff-upload.pdf' },
  { id: 10, category: 'policy', filename: 'policy.pdf' },
];

vi.mock('@/lib/security/auth', () => ({
  getSession: getSessionMock,
}));

vi.mock('@/lib/security/client-scope', () => ({
  canAccessOrder: canAccessOrderMock,
}));

vi.mock('@/lib/db/schema', () => ({
  documents: {
    id: 'documents.id',
    category: 'documents.category',
    filename: 'documents.filename',
    originalFilename: 'documents.originalFilename',
    contentType: 'documents.contentType',
    sizeBytes: 'documents.sizeBytes',
    description: 'documents.description',
    createdAt: 'documents.createdAt',
    orderId: 'documents.orderId',
    status: 'documents.status',
  },
}));

vi.mock('drizzle-orm', () => ({
  and: (...conditions: unknown[]) => ({ op: 'and', conditions }),
  desc: (field: unknown) => ({ op: 'desc', field }),
  eq: (field: unknown, value: unknown) => ({ op: 'eq', field, value }),
  inArray: inArrayMock,
}));

vi.mock('@/lib/db/client', () => {
  const chain = {
    from: vi.fn(() => chain),
    where: whereMock.mockImplementation(() => chain),
    orderBy: orderByMock.mockImplementation(async () => {
      const categoryFilter = inArrayMock.mock.calls.find(
        (call) => call[0] === 'documents.category',
      );
      const allowed = new Set((categoryFilter?.[1] as string[] | undefined) ?? []);
      return MIXED_DOCS.filter((doc) => allowed.has(doc.category));
    }),
  };
  return {
    db: {
      select: vi.fn(() => chain),
    },
  };
});

import { CLIENT_DOCUMENT_CATEGORIES, GET } from './route';

describe('GET /api/client/orders/[id]/documents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ id: 'client-1', role: 'client' });
    canAccessOrderMock.mockResolvedValue(true);
  });

  it('returns only client-safe categories on an order with mixed documents', async () => {
    const response = await GET({} as never, { params: Promise.resolve({ id: '42' }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(canAccessOrderMock).toHaveBeenCalledWith('client-1', 42);
    expect(inArrayMock).toHaveBeenCalledWith(
      'documents.category',
      [...CLIENT_DOCUMENT_CATEGORIES],
    );
    expect(CLIENT_DOCUMENT_CATEGORIES).toEqual([
      'prelim',
      'cpl',
      'proposed_insured',
      'legal_vesting',
      'tax',
      'grant_deed',
    ]);

    const categories = (body.documents as Array<{ category: string }>).map((d) => d.category);
    expect(categories).toEqual([
      'prelim',
      'cpl',
      'proposed_insured',
      'legal_vesting',
      'tax',
      'grant_deed',
    ]);
    for (const hidden of ['curative', 'general', 'user_upload', 'policy'] as const) {
      expect(categories).not.toContain(hidden);
    }
  });
});

