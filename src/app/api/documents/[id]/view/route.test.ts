import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  canAccessDocumentOrderMock,
  getDocumentByIdMock,
  getObjectStreamMock,
  getSessionMock,
  insertValuesMock,
} = vi.hoisted(() => ({
  canAccessDocumentOrderMock: vi.fn(),
  getDocumentByIdMock: vi.fn(),
  getObjectStreamMock: vi.fn(),
  getSessionMock: vi.fn(),
  insertValuesMock: vi.fn(),
}));

vi.mock('@/lib/security/auth', () => ({
  getSession: getSessionMock,
}));

vi.mock('@/lib/security/document-access', () => ({
  canAccessDocumentOrder: canAccessDocumentOrderMock,
}));

vi.mock('@/lib/domain/documents/service', () => ({
  getDocumentById: getDocumentByIdMock,
}));

vi.mock('@/lib/integrations/s3/client', () => ({
  getObjectStream: getObjectStreamMock,
}));

vi.mock('@/lib/db/client', () => ({
  db: {
    insert: vi.fn(() => ({ values: insertValuesMock })),
  },
}));

vi.mock('@/lib/db/schema', () => ({
  documentAudit: {},
}));

import { GET } from './route';

const DOC = {
  id: 42,
  orderId: 100,
  status: 'active',
  filename: 'prelim.pdf',
  storageKey: 'orders/100/prelim.pdf',
  contentType: 'application/pdf',
};

describe('GET /api/documents/[id]/view ACL', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ id: 'user-1', role: 'escrow_officer', contactId: 7 });
    getDocumentByIdMock.mockResolvedValue(DOC);
    canAccessDocumentOrderMock.mockResolvedValue(true);
    getObjectStreamMock.mockResolvedValue({
      success: true,
      data: {
        body: new ReadableStream(),
        contentType: 'application/pdf',
        contentLength: 10,
      },
    });
    insertValuesMock.mockResolvedValue(undefined);
  });

  it('returns 404 when caller cannot access the document order', async () => {
    canAccessDocumentOrderMock.mockResolvedValue(false);

    const response = await GET({} as never, { params: Promise.resolve({ id: '42' }) });

    expect(response.status).toBe(404);
    expect(canAccessDocumentOrderMock).toHaveBeenCalledWith(
      { id: 'user-1', role: 'escrow_officer', contactId: 7 },
      100,
    );
    expect(getObjectStreamMock).not.toHaveBeenCalled();
  });

  it('streams the document when caller can access the order', async () => {
    const response = await GET({} as never, { params: Promise.resolve({ id: '42' }) });

    expect(response.status).toBe(200);
    expect(getObjectStreamMock).toHaveBeenCalledWith('orders/100/prelim.pdf');
    expect(response.headers.get('Content-Disposition')).toContain('inline');
  });
});
