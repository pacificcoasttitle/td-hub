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

const andMock = vi.fn((...args: unknown[]) => args);
const inArrayMock = vi.fn((...args: unknown[]) => ({ op: 'inArray', args }));

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => andMock(...args),
  asc: vi.fn((x: unknown) => x),
  eq: vi.fn((...args: unknown[]) => args),
  inArray: (...args: unknown[]) => inArrayMock(...args),
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
    vi.resetModules();
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

  it('restricts selection to TD-Hub-generated categories (never prelim/policy)', async () => {
    selectLimitMock.mockResolvedValue([
      { id: 10, category: 'proposed_insured', softproAttachAttemptCount: 0 },
      { id: 11, category: 'legal_vesting', softproAttachAttemptCount: 0 },
      { id: 12, category: 'tax', softproAttachAttemptCount: 0 },
    ]);
    attachToSoftProMock.mockResolvedValue({ success: true, softproDocumentId: 'ok' });

    const {
      handleRetrySoftProDocumentAttach,
      SOFTPRO_RETRY_ATTACH_CATEGORIES,
    } = await import('./retry-softpro-document-attach');

    expect([...SOFTPRO_RETRY_ATTACH_CATEGORIES]).toEqual([
      'cpl',
      'proposed_insured',
      'legal_vesting',
      'tax',
      'grant_deed',
    ]);
    expect(SOFTPRO_RETRY_ATTACH_CATEGORIES).not.toContain('prelim');
    expect(SOFTPRO_RETRY_ATTACH_CATEGORIES).not.toContain('policy');
    expect(SOFTPRO_RETRY_ATTACH_CATEGORIES).not.toContain('general');

    await handleRetrySoftProDocumentAttach();

    expect(inArrayMock).toHaveBeenCalledWith(
      'documents.category',
      [...SOFTPRO_RETRY_ATTACH_CATEGORIES],
    );
    const whereArgs = andMock.mock.calls.at(-1) ?? [];
    expect(whereArgs.some((arg) => (
      typeof arg === 'object'
      && arg !== null
      && (arg as { op?: string }).op === 'inArray'
    ))).toBe(true);

    // Selection mock never returns prelim — attach must not be invoked for fetched categories.
    expect(attachToSoftProMock).not.toHaveBeenCalledWith(expect.any(Number), 'prelim');
    expect(attachToSoftProMock.mock.calls.map((c) => c[0])).toEqual([10, 11, 12]);
  });
});
