import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getTitlePointRecordMock,
  pollSearchMock,
  fetchResultMock,
  fetchImageMock,
  fetchGrantDeedMock,
  maybeEnqueueConfirmationMock,
} = vi.hoisted(() => ({
  getTitlePointRecordMock: vi.fn(),
  pollSearchMock: vi.fn(),
  fetchResultMock: vi.fn(),
  fetchImageMock: vi.fn(),
  fetchGrantDeedMock: vi.fn(),
  maybeEnqueueConfirmationMock: vi.fn(),
}));

vi.mock('@/lib/domain/titlepoint/service', () => ({
  getTitlePointRecord: (...a: unknown[]) => getTitlePointRecordMock(...a),
  pollSearch: (...a: unknown[]) => pollSearchMock(...a),
  fetchResult: (...a: unknown[]) => fetchResultMock(...a),
  fetchImage: (...a: unknown[]) => fetchImageMock(...a),
}));

vi.mock('@/lib/domain/titlepoint/grant-deed', () => ({
  fetchGrantDeed: (...a: unknown[]) => fetchGrantDeedMock(...a),
}));

vi.mock('@/lib/domain/titlepoint/completion-checker', () => ({
  maybeEnqueueConfirmation: (...a: unknown[]) => maybeEnqueueConfirmationMock(...a),
}));

import { processTitlePointWork } from './process-work';

describe('processTitlePointWork', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    maybeEnqueueConfirmationMock.mockResolvedValue(true);
    fetchGrantDeedMock.mockResolvedValue({ success: true });
  });

  it('does not re-generate a completed row (idempotent)', async () => {
    getTitlePointRecordMock.mockResolvedValue({
      id: 10,
      status: 'completed',
      orderId: 50,
      searchType: 'tax',
    });

    const result = await processTitlePointWork(10);

    expect(result).toMatchObject({ status: 'completed', skipped: true });
    expect(fetchImageMock).not.toHaveBeenCalled();
    expect(pollSearchMock).not.toHaveBeenCalled();
    expect(maybeEnqueueConfirmationMock).toHaveBeenCalledWith(50);
  });

  it('finishes result_ready via fetchImage and enqueues confirmation', async () => {
    getTitlePointRecordMock
      .mockResolvedValueOnce({
        id: 11,
        status: 'result_ready',
        orderId: 60,
        searchType: 'tax',
      })
      .mockResolvedValueOnce({
        id: 11,
        status: 'result_ready',
        orderId: 60,
        searchType: 'tax',
      });
    fetchImageMock.mockResolvedValue({ success: true, documentId: 99 });

    const result = await processTitlePointWork(11);

    expect(result).toMatchObject({ status: 'completed', documentId: 99 });
    expect(fetchImageMock).toHaveBeenCalledWith(11);
    expect(fetchGrantDeedMock).not.toHaveBeenCalled();
    expect(maybeEnqueueConfirmationMock).toHaveBeenCalledWith(60);
  });

  it('runs grant-deed only after LV image completes', async () => {
    getTitlePointRecordMock
      .mockResolvedValueOnce({
        id: 12,
        status: 'result_ready',
        orderId: 70,
        searchType: 'legal_vesting',
      })
      .mockResolvedValueOnce({
        id: 12,
        status: 'result_ready',
        orderId: 70,
        searchType: 'legal_vesting',
      });
    fetchImageMock.mockResolvedValue({ success: true, documentId: 100 });

    await processTitlePointWork(12);

    expect(fetchImageMock).toHaveBeenCalledWith(12);
    expect(fetchGrantDeedMock).toHaveBeenCalledWith(12);
  });

  it('does not run grant-deed when LV fetchImage fails', async () => {
    getTitlePointRecordMock
      .mockResolvedValueOnce({
        id: 13,
        status: 'result_ready',
        orderId: 80,
        searchType: 'legal_vesting',
      })
      .mockResolvedValueOnce({
        id: 13,
        status: 'result_ready',
        orderId: 80,
        searchType: 'legal_vesting',
      });
    fetchImageMock.mockResolvedValue({ success: false, error: 'Image request failed' });

    const result = await processTitlePointWork(13);

    expect(result.status).toBe('failed');
    expect(fetchGrantDeedMock).not.toHaveBeenCalled();
  });
});
