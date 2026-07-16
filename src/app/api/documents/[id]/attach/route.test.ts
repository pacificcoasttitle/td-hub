import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  attachToSoftProMock,
  canAccessDocumentOrderMock,
  getDocumentByIdMock,
  getSessionMock,
} = vi.hoisted(() => ({
  attachToSoftProMock: vi.fn(),
  canAccessDocumentOrderMock: vi.fn(),
  getDocumentByIdMock: vi.fn(),
  getSessionMock: vi.fn(),
}));

vi.mock('@/lib/security/auth', () => ({
  getSession: getSessionMock,
}));

vi.mock('@/lib/security/document-access', () => ({
  canAccessDocumentOrder: canAccessDocumentOrderMock,
}));

vi.mock('@/lib/domain/documents/service', () => ({
  attachToSoftPro: attachToSoftProMock,
  getDocumentById: getDocumentByIdMock,
}));

import { POST } from './route';

const DOC = {
  id: 42,
  orderId: 100,
  status: 'active',
  filename: 'prelim.pdf',
};

describe('POST /api/documents/[id]/attach ACL', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ id: 'user-1', role: 'title_officer', contactId: 5 });
    getDocumentByIdMock.mockResolvedValue(DOC);
    canAccessDocumentOrderMock.mockResolvedValue(true);
    attachToSoftProMock.mockResolvedValue({ success: true });
  });

  it('returns 404 when caller cannot access the document order', async () => {
    canAccessDocumentOrderMock.mockResolvedValue(false);

    const response = await POST({} as never, { params: Promise.resolve({ id: '42' }) });

    expect(response.status).toBe(404);
    expect(canAccessDocumentOrderMock).toHaveBeenCalledWith(
      { id: 'user-1', role: 'title_officer', contactId: 5 },
      100,
    );
    expect(attachToSoftProMock).not.toHaveBeenCalled();
  });

  it('attaches when caller can access the order', async () => {
    const response = await POST({} as never, { params: Promise.resolve({ id: '42' }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(attachToSoftProMock).toHaveBeenCalledWith(42);
  });

  it('allows staff with order access unchanged', async () => {
    getSessionMock.mockResolvedValue({ id: 'admin-1', role: 'cs_admin', contactId: null });

    const response = await POST({} as never, { params: Promise.resolve({ id: '42' }) });

    expect(response.status).toBe(200);
    expect(canAccessDocumentOrderMock).toHaveBeenCalledWith(
      { id: 'admin-1', role: 'cs_admin', contactId: null },
      100,
    );
    expect(attachToSoftProMock).toHaveBeenCalledWith(42);
  });
});
