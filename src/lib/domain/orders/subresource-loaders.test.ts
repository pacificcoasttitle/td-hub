import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const {
  getFeesMock,
  getOrderByIdSimpleMock,
  inArrayMock,
  eqMock,
  andMock,
  selectMock,
  insertValuesMock,
  returningMock,
  resolveRowsMock,
} = vi.hoisted(() => ({
  getFeesMock: vi.fn(),
  getOrderByIdSimpleMock: vi.fn(),
  inArrayMock: vi.fn((field: unknown, values: unknown[]) => ({ op: 'inArray', field, values })),
  eqMock: vi.fn((field: unknown, value: unknown) => ({ op: 'eq', field, value })),
  andMock: vi.fn((...conditions: unknown[]) => ({ op: 'and', conditions })),
  selectMock: vi.fn(),
  insertValuesMock: vi.fn(),
  returningMock: vi.fn(),
  resolveRowsMock: vi.fn(),
}));

vi.mock('@/lib/domain/orders/service', () => ({
  getOrderByIdSimple: getOrderByIdSimpleMock,
}));

vi.mock('@/lib/integrations/softpro', () => ({
  getFees: getFeesMock,
  addNotes: vi.fn(async () => ({ success: false })),
}));

vi.mock('@/lib/db/schema', () => ({
  docCategoryEnum: {
    enumValues: [
      'cpl', 'prelim', 'policy', 'legal_vesting', 'grant_deed', 'tax',
      'general', 'user_upload', 'proposed_insured', 'curative',
    ],
  },
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
  orders: { id: 'orders.id', fileNumber: 'orders.file_number' },
  documentAudit: {
    action: 'document_audit.action',
    performedAt: 'document_audit.performed_at',
    byUserId: 'document_audit.by_user_id',
    meta: 'document_audit.meta',
    documentId: 'document_audit.document_id',
  },
  orderStatusHistory: {
    status: 'osh.status',
    source: 'osh.source',
    notes: 'osh.notes',
    changedAt: 'osh.changed_at',
    orderId: 'osh.order_id',
  },
  vendorApiLogs: {
    vendor: 'val.vendor',
    operation: 'val.operation',
    success: 'val.success',
    httpStatus: 'val.http_status',
    createdAt: 'val.created_at',
    orderId: 'val.order_id',
  },
  titlePointData: {
    searchType: 'tp.search_type',
    status: 'tp.status',
    message: 'tp.message',
    createdAt: 'tp.created_at',
    orderId: 'tp.order_id',
  },
  adminActivityLogs: {
    createdAt: 'aal.created_at',
    userId: 'aal.user_id',
    meta: 'aal.meta',
    action: 'aal.action',
    entityType: 'aal.entity_type',
    entityId: 'aal.entity_id',
  },
}));

vi.mock('drizzle-orm', () => ({
  and: andMock,
  desc: (field: unknown) => ({ op: 'desc', field }),
  eq: eqMock,
  inArray: inArrayMock,
}));

const MIXED_DOCS = [
  { id: 1, category: 'prelim', filename: 'prelim.pdf', originalFilename: null, contentType: 'application/pdf', sizeBytes: 1, description: null, createdAt: new Date('2026-01-01') },
  { id: 2, category: 'curative', filename: 'curative.pdf', originalFilename: null, contentType: 'application/pdf', sizeBytes: 1, description: null, createdAt: new Date('2026-01-02') },
  { id: 3, category: 'cpl', filename: 'cpl.pdf', originalFilename: null, contentType: 'application/pdf', sizeBytes: 1, description: null, createdAt: new Date('2026-01-03') },
];

const MIXED_NOTES = [
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
];

function makeChain() {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.from = vi.fn(self);
  chain.where = vi.fn(self);
  chain.innerJoin = vi.fn(self);
  chain.orderBy = vi.fn(self);
  chain.limit = vi.fn(() => resolveRowsMock());
  // Allow `await db.select()...orderBy()` (documents/notes) without calling limit.
  chain.then = (
    onFulfilled: (value: unknown) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ) => Promise.resolve(resolveRowsMock()).then(onFulfilled, onRejected);
  return chain;
}

vi.mock('@/lib/db/client', () => ({
  db: {
    select: selectMock.mockImplementation(() => makeChain()),
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
}));

import {
  CLIENT_DOCUMENT_CATEGORIES,
  getOrderDocuments,
} from './documents';
import { getOrderFees } from './fees';
import { getOrderNotes, createOrderNote } from './notes';
import { clearOrderActivityCache, getOrderActivity } from './activity';

describe('getOrderDocuments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveRowsMock.mockImplementation(async () => {
      const categoryFilter = inArrayMock.mock.calls.find(
        (call) => call[0] === 'documents.category',
      );
      if (categoryFilter) {
        const allowed = new Set((categoryFilter[1] as string[]) ?? []);
        return MIXED_DOCS.filter((doc) => allowed.has(doc.category));
      }
      return MIXED_DOCS;
    });
  });

  it('enforces the client category whitelist inside the loader', async () => {
    const result = await getOrderDocuments(42, 'client');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(inArrayMock).toHaveBeenCalledWith(
      'documents.category',
      [...CLIENT_DOCUMENT_CATEGORIES],
    );
    expect(result.documents.map((d) => d.category)).toEqual(['prelim', 'cpl']);
    expect(result.documents[0]).not.toHaveProperty('createdBy');
    for (const hidden of ['curative', 'general', 'user_upload', 'policy'] as const) {
      expect(result.documents.map((d) => d.category)).not.toContain(hidden);
    }
  });

  it('returns staff documents without the client whitelist', async () => {
    const result = await getOrderDocuments(42, 'staff');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(inArrayMock).not.toHaveBeenCalled();
    expect(result.documents).toHaveLength(3);
  });

  it('rejects invalid staff category filters', async () => {
    const result = await getOrderDocuments(42, 'staff', { category: 'not-a-cat' });
    expect(result).toEqual({ ok: false, error: 'invalid_category' });
  });
});

describe('getOrderFees', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getOrderByIdSimpleMock.mockResolvedValue({ id: 1, fileNumber: '20012345-OCT' });
  });

  it('returns the M5 invoices shape for staff including invoiceDate', async () => {
    getFeesMock.mockResolvedValue({
      success: true,
      data: [{
        InvoiceNumber: 'INV-1',
        InvoiceDate: '2026-01-15',
        Fees: [{ Description: 'Title', Amount: 100 }],
        Total: { Amount: 100 },
      }],
    });

    const result = await getOrderFees(1, 'staff');
    expect(result).toEqual({
      ok: true,
      success: true,
      data: {
        invoices: [{
          invoiceNumber: 'INV-1',
          invoiceDate: '2026-01-15',
          fees: [{ description: 'Title', amount: 100 }],
          total: 100,
        }],
        grandTotal: 100,
      },
    });
  });

  it('omits invoiceDate and uses client error copy for client SoftPro failures', async () => {
    getFeesMock.mockResolvedValue({
      success: true,
      data: [{
        InvoiceNumber: 'INV-1',
        InvoiceDate: '2026-01-15',
        Fees: [{ Description: 'Title', Amount: 50 }],
        Total: { Amount: 50 },
      }],
    });

    const ok = await getOrderFees(1, 'client');
    expect(ok.ok && ok.success).toBe(true);
    if (ok.ok && ok.success) {
      expect(ok.data.invoices[0]).not.toHaveProperty('invoiceDate');
      expect(ok.data.invoices[0].invoiceNumber).toBe('INV-1');
    }

    getFeesMock.mockResolvedValue({ success: false, error: { message: 'vendor down' } });
    const fail = await getOrderFees(1, 'client');
    expect(fail).toEqual({
      ok: true,
      success: false,
      error: 'Fee information is not available at this time',
    });
  });
});

describe('getOrderNotes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveRowsMock.mockResolvedValue(MIXED_NOTES);
    returningMock.mockResolvedValue([
      {
        id: 99,
        subject: null,
        body: 'note',
        authorName: 'Officer',
        createdAt: new Date('2026-01-03'),
        isInternal: true,
      },
    ]);
  });

  it('staff sees internal + shared notes with isInternal', async () => {
    const { notes } = await getOrderNotes(123, 'staff');
    expect(notes).toHaveLength(2);
    expect(notes.map((n) => n.isInternal)).toEqual([true, false]);
    expect(eqMock).toHaveBeenCalledWith('order_notes.order_id', 123);
    expect(eqMock).not.toHaveBeenCalledWith('order_notes.is_internal', expect.anything());
  });

  it('client loader enforces is_internal = false and omits isInternal field', async () => {
    resolveRowsMock.mockResolvedValue([
      {
        id: 2,
        subject: 'Shared',
        body: 'Client note',
        authorName: 'Officer',
        createdAt: new Date('2026-01-02'),
        isSyncedToSoftpro: false,
      },
    ]);

    const { notes } = await getOrderNotes(123, 'client');
    expect(notes).toHaveLength(1);
    expect(notes[0]).not.toHaveProperty('isInternal');
    expect(eqMock).toHaveBeenCalledWith('order_notes.is_internal', false);
  });

  it('createOrderNote defaults staff notes to internal', async () => {
    resolveRowsMock.mockResolvedValue([{ fileNumber: '20012345-OCT' }]);
    const result = await createOrderNote({
      orderId: 123,
      visibility: 'staff',
      text: 'secret',
      authorName: 'Officer',
      authorId: 'staff-1',
    });
    expect(result.ok).toBe(true);
    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({ isInternal: true, body: 'secret' }),
    );
  });
});

describe('getOrderActivity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearOrderActivityCache();
    resolveRowsMock.mockResolvedValue([]);
  });

  it('client activity filters document audits to the whitelist categories', async () => {
    await getOrderActivity(9, 'client');
    expect(inArrayMock).toHaveBeenCalledWith(
      'documents.category',
      [...CLIENT_DOCUMENT_CATEGORIES],
    );
  });

  it('staff activity does not apply the client document whitelist', async () => {
    await getOrderActivity(9, 'staff', { limit: 10 });
    const categoryCalls = inArrayMock.mock.calls.filter(
      (call) => call[0] === 'documents.category',
    );
    expect(categoryCalls).toHaveLength(0);
  });
});

describe('routes and DetailModal consumers', () => {
  const root = join(__dirname, '../../..');

  it('client routes no longer embed whitelist / is_internal enforcement', () => {
    const clientDocs = readFileSync(join(root, 'app/api/client/orders/[id]/documents/route.ts'), 'utf8');
    const clientNotes = readFileSync(join(root, 'app/api/client/orders/[id]/notes/route.ts'), 'utf8');
    expect(clientDocs).toContain("getOrderDocuments(orderId, 'client')");
    expect(clientDocs).not.toMatch(/inArray\(documents\.category/);
    expect(clientNotes).toContain("getOrderNotes(orderId, 'client')");
    expect(clientNotes).not.toMatch(/eq\(orderNotes\.isInternal/);
  });

  it('DetailModal tabs still hit the same subresource URLs (shape-stable)', () => {
    const detail = readFileSync(
      join(root, 'components/shared/action-modals/detail-modal.tsx'),
      'utf8',
    );
    expect(detail).toContain('fetch(`${base}/documents`)');
    expect(detail).toContain('fetch(`${base}/fees`)');
    expect(detail).toContain('fetchUrl={`${base}/activity`}');
    expect(detail).toContain('notesUrl={`${base}/notes`}');
    expect(detail).toContain('interface FeeInvoice');
    expect(detail).toContain('grandTotal');
  });

  it('staff and client routes all call the canonical loaders', () => {
    const files = [
      'app/api/orders/[id]/documents/route.ts',
      'app/api/orders/[id]/fees/route.ts',
      'app/api/orders/[id]/notes/route.ts',
      'app/api/orders/[id]/activity/route.ts',
      'app/api/client/orders/[id]/documents/route.ts',
      'app/api/client/orders/[id]/fees/route.ts',
      'app/api/client/orders/[id]/notes/route.ts',
      'app/api/client/orders/[id]/activity/route.ts',
    ];
    for (const rel of files) {
      const src = readFileSync(join(root, rel), 'utf8');
      expect(src).toMatch(/getOrder(Documents|Fees|Notes|Activity)/);
    }
  });
});
