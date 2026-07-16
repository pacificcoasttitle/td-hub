import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  canAccessDocumentOrderMock,
  getSessionMock,
  uploadDocumentMock,
} = vi.hoisted(() => ({
  canAccessDocumentOrderMock: vi.fn(),
  getSessionMock: vi.fn(),
  uploadDocumentMock: vi.fn(),
}));

vi.mock('@/lib/security/auth', () => ({
  getSession: getSessionMock,
}));

vi.mock('@/lib/security/document-access', () => ({
  canAccessDocumentOrder: canAccessDocumentOrderMock,
}));

vi.mock('@/lib/domain/documents/service', () => ({
  uploadDocument: uploadDocumentMock,
}));

vi.mock('@/lib/db/schema/documents', () => ({
  docCategoryEnum: {
    enumValues: ['general', 'prelim', 'cpl', 'user_upload'] as const,
  },
}));

import { POST } from './route';

function formRequest(orderId: string) {
  const formData = new FormData();
  formData.set('orderId', orderId);
  formData.set('category', 'general');
  formData.set('file', new File(['hello'], 'note.pdf', { type: 'application/pdf' }));
  return {
    formData: async () => formData,
  } as never;
}

describe('POST /api/documents/upload ACL', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ id: 'user-1', role: 'title_officer', contactId: 5 });
    canAccessDocumentOrderMock.mockResolvedValue(true);
    uploadDocumentMock.mockResolvedValue({
      documentId: 99,
      storageKey: 'orders/100/note.pdf',
    });
  });

  it('returns 404 when caller cannot access the target order', async () => {
    canAccessDocumentOrderMock.mockResolvedValue(false);

    const response = await POST(formRequest('100'));

    expect(response.status).toBe(404);
    expect(canAccessDocumentOrderMock).toHaveBeenCalledWith(
      { id: 'user-1', role: 'title_officer', contactId: 5 },
      100,
    );
    expect(uploadDocumentMock).not.toHaveBeenCalled();
  });

  it('uploads when caller can access the target order', async () => {
    const response = await POST(formRequest('100'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.documentId).toBe(99);
    expect(uploadDocumentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 100,
        filename: 'note.pdf',
        userId: 'user-1',
      }),
    );
  });

  it('allows staff with order access unchanged', async () => {
    getSessionMock.mockResolvedValue({ id: 'admin-1', role: 'admin', contactId: null });

    const response = await POST(formRequest('100'));

    expect(response.status).toBe(200);
    expect(canAccessDocumentOrderMock).toHaveBeenCalledWith(
      { id: 'admin-1', role: 'admin', contactId: null },
      100,
    );
    expect(uploadDocumentMock).toHaveBeenCalled();
  });
});
