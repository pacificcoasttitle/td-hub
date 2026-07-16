import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  applyVisibilityMock,
  canAccessOrderMock,
  getOrderReadModelMock,
  getSessionMock,
} = vi.hoisted(() => ({
  applyVisibilityMock: vi.fn(),
  canAccessOrderMock: vi.fn(),
  getOrderReadModelMock: vi.fn(),
  getSessionMock: vi.fn(),
}));

vi.mock('@/lib/security/auth', () => ({ getSession: getSessionMock }));
vi.mock('@/lib/security/client-scope', () => ({ canAccessOrder: canAccessOrderMock }));
vi.mock('@/lib/domain/orders/read-model', () => ({
  applyVisibility: applyVisibilityMock,
  getOrderReadModel: getOrderReadModelMock,
}));

import { GET } from './route';

const readModel = {
  status: { value: 'in_process', label: 'In Process', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  milestones: [
    { key: 'opened', label: 'Order Opened', state: 'complete', date: 'Jul 15, 2026', documentId: null },
    { key: 'prelim', label: 'Prelim Received', state: 'complete', date: 'Jul 16, 2026', documentId: 10 },
    { key: 'recording', label: 'Recording Confirmation', state: 'in_progress', date: '—', documentId: null },
    { key: 'disbursement', label: 'Funds Disbursed', state: 'pending', date: '—', documentId: null },
    { key: 'closed', label: 'Order Closed', state: 'pending', date: '—', documentId: null },
  ],
};

describe('GET /api/client/orders/[id]/timeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ id: 'client-1' });
    canAccessOrderMock.mockResolvedValue(true);
    getOrderReadModelMock.mockResolvedValue(readModel);
    applyVisibilityMock.mockImplementation((model) => model);
  });

  it('projects canonical read-model milestones into the client timeline response', async () => {
    const response = await GET({} as never, { params: Promise.resolve({ id: '100' }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(getOrderReadModelMock).toHaveBeenCalledWith(100);
    expect(applyVisibilityMock).toHaveBeenCalledWith(readModel, 'client');
    expect(body).toEqual({
      status: 'in_process',
      milestones: [
        { name: 'Order Opened', status: 'complete', date: 'Jul 15, 2026', documentId: null },
        { name: 'Prelim Received', status: 'complete', date: 'Jul 16, 2026', documentId: 10 },
        { name: 'Recording Confirmation', status: 'in_progress', date: null, documentId: null },
        { name: 'Funds Disbursed', status: 'pending', date: null, documentId: null },
        { name: 'Order Closed', status: 'pending', date: null, documentId: null },
      ],
    });
  });
});
