import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  selectWhereMock,
  updateSetMock,
  fetchImageMock,
  fetchGrantDeedMock,
  enqueueMock,
  maybeEnqueueConfirmationMock,
} = vi.hoisted(() => ({
  selectWhereMock: vi.fn(),
  updateSetMock: vi.fn(),
  fetchImageMock: vi.fn(),
  fetchGrantDeedMock: vi.fn(),
  enqueueMock: vi.fn(),
  maybeEnqueueConfirmationMock: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: selectWhereMock,
      })),
    })),
    update: vi.fn(() => ({
      set: (vals: unknown) => {
        updateSetMock(vals);
        return { where: vi.fn(async () => undefined) };
      },
    })),
    insert: vi.fn(() => ({
      values: vi.fn(async () => undefined),
    })),
  },
}));

vi.mock('@/lib/db/schema', () => ({
  titlePointData: {
    id: 'id',
    status: 'status',
    searchType: 'search_type',
    sessionId: 'session_id',
    orderId: 'order_id',
    fileNumber: 'file_number',
    updatedAt: 'updated_at',
  },
  vendorApiLogs: {},
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...a: unknown[]) => a),
}));

vi.mock('@/lib/integrations/titlepoint/client', () => ({
  createServicePreOrderLv: vi.fn(),
  createServicePreOrderTax: vi.fn(),
}));

vi.mock('@/lib/integrations/titlepoint/fips', () => ({
  resolveCaliforniaFips: vi.fn(),
}));

vi.mock('./service', () => ({
  executePipeline: vi.fn(),
  fetchImage: (...a: unknown[]) => fetchImageMock(...a),
}));

vi.mock('./grant-deed', () => ({
  fetchGrantDeed: (...a: unknown[]) => fetchGrantDeedMock(...a),
}));

vi.mock('./completion-checker', () => ({
  maybeEnqueueConfirmation: (...a: unknown[]) => maybeEnqueueConfirmationMock(...a),
}));

vi.mock('./poll-queue', async () => {
  const actual = await vi.importActual<typeof import('./poll-queue')>('./poll-queue');
  return {
    ...actual,
    // Force short-sync to skip fetchImage (budget exhausted) → enqueue path
    TITLEPOINT_SHORT_SYNC_MS: 0,
    TITLEPOINT_MIN_IMAGE_BUDGET_MS: 2_000,
    enqueueTitlePointPollJob: (...a: unknown[]) => enqueueMock(...a),
  };
});

vi.mock('@/lib/domain/settings/service', () => ({
  getSetting: vi.fn(),
}));

import { linkSessionToOrder } from './pre-initiate';

describe('linkSessionToOrder OC-2 handoff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    maybeEnqueueConfirmationMock.mockResolvedValue(false);
    enqueueMock.mockResolvedValue({ enqueued: true, jobId: 1 });
    selectWhereMock.mockResolvedValue([
      { id: 101, status: 'result_ready', searchType: 'tax' },
      { id: 102, status: 'result_ready', searchType: 'legal_vesting' },
    ]);
  });

  it('returns without waiting on full fetchImage when short-sync budget is exhausted', async () => {
    const result = await linkSessionToOrder('tp_api_id_1', 50, '20019999-TEST');

    expect(fetchImageMock).not.toHaveBeenCalled();
    expect(enqueueMock).toHaveBeenCalledTimes(2);
    expect(enqueueMock).toHaveBeenCalledWith({ titlePointDataId: 101, orderId: 50 });
    expect(enqueueMock).toHaveBeenCalledWith({ titlePointDataId: 102, orderId: 50 });
    expect(result).toMatchObject({ linked: 2, finished: 0, enqueued: 2 });
    expect(maybeEnqueueConfirmationMock).toHaveBeenCalledWith(50);
  });

  it('links orderId/fileNumber synchronously before handoff', async () => {
    await linkSessionToOrder('tp_api_id_1', 50, '20019999-TEST');

    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 50,
        fileNumber: '20019999-TEST',
      }),
    );
  });
});
