import { beforeEach, describe, expect, it, vi } from 'vitest';

const attachToSoftProMock = vi.fn();
const selectLimitMock = vi.fn();

vi.mock('@/lib/domain/documents/service', () => ({
  attachToSoftPro: (...args: unknown[]) => attachToSoftProMock(...args),
}));

vi.mock('@/lib/db/schema', () => ({
  documents: {
    id: 'documents.id',
    category: 'documents.category',
    status: 'documents.status',
    createdAt: 'documents.created_at',
    isSyncedToSoftpro: 'documents.is_synced',
    softproAttachAttemptCount: 'documents.attempts',
    softproAttachNextRetryAt: 'documents.next_retry',
  },
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => args),
  asc: vi.fn((x: unknown) => x),
  eq: vi.fn((...args: unknown[]) => args),
  isNull: vi.fn((x: unknown) => x),
  lt: vi.fn((...args: unknown[]) => args),
  lte: vi.fn((...args: unknown[]) => args),
  or: vi.fn((...args: unknown[]) => args),
}));

vi.mock('@/lib/db/client', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: selectLimitMock,
          })),
        })),
      })),
    })),
  },
}));

describe('handleRetrySoftProDocumentAttach', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retries unsynced docs and counts synced vs failed', async () => {
    selectLimitMock.mockResolvedValue([
      { id: 1, category: 'cpl', softproAttachAttemptCount: 1 },
      { id: 2, category: 'grant_deed', softproAttachAttemptCount: 2 },
    ]);
    attachToSoftProMock
      .mockResolvedValueOnce({ success: true, softproDocumentId: 'SP-1' })
      .mockResolvedValueOnce({ success: false, error: 'still failing' });

    const { handleRetrySoftProDocumentAttach } = await import('./retry-softpro-document-attach');
    const result = await handleRetrySoftProDocumentAttach();

    expect(attachToSoftProMock).toHaveBeenCalledWith(1, 'CPL');
    expect(attachToSoftProMock).toHaveBeenCalledWith(2, 'Title Docs');
    expect(result).toMatchObject({
      total: 2,
      attempted: 2,
      synced: 1,
      failed: 1,
    });
    expect(result.errors).toEqual([{ documentId: 2, error: 'still failing' }]);
  });
});
