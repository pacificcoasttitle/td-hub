import { beforeEach, describe, expect, it, vi } from 'vitest';

const { executeMock, insertReturningMock, selectLimitMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
  insertReturningMock: vi.fn(),
  selectLimitMock: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: selectLimitMock,
        })),
      })),
    })),
    execute: (...a: unknown[]) => executeMock(...a),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: insertReturningMock,
      })),
    })),
  },
}));

vi.mock('@/lib/db/schema', () => ({
  jobs: { id: 'jobs.id' },
  titlePointData: {
    id: 'tp.id',
    status: 'tp.status',
    orderId: 'tp.order_id',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...a: unknown[]) => a),
  sql: Object.assign(
    (strings: TemplateStringsArray, ..._v: unknown[]) => ({ strings }),
    {},
  ),
}));

import { enqueueTitlePointPollJob, titlePointRetryDelayMs } from './poll-queue';

describe('enqueueTitlePointPollJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips enqueue when title_point_data is already completed', async () => {
    selectLimitMock.mockResolvedValue([{ id: 1, status: 'completed', orderId: 9 }]);

    const result = await enqueueTitlePointPollJob({ titlePointDataId: 1, orderId: 9 });

    expect(result).toEqual({
      enqueued: false,
      jobId: null,
      reason: 'already_completed',
    });
    expect(insertReturningMock).not.toHaveBeenCalled();
  });

  it('skips enqueue when an active job already exists', async () => {
    selectLimitMock.mockResolvedValue([{ id: 2, status: 'result_ready', orderId: 9 }]);
    executeMock.mockResolvedValue([{ id: 55 }]);

    const result = await enqueueTitlePointPollJob({ titlePointDataId: 2, orderId: 9 });

    expect(result).toEqual({
      enqueued: false,
      jobId: 55,
      reason: 'active_job_exists',
    });
    expect(insertReturningMock).not.toHaveBeenCalled();
  });

  it('enqueues a queued titlepoint.poll job', async () => {
    selectLimitMock.mockResolvedValue([{ id: 3, status: 'result_ready', orderId: 9 }]);
    executeMock.mockResolvedValue([]);
    insertReturningMock.mockResolvedValue([{ id: 77 }]);

    const result = await enqueueTitlePointPollJob({ titlePointDataId: 3, orderId: 9 });

    expect(result).toEqual({ enqueued: true, jobId: 77 });
  });
});

describe('titlePointRetryDelayMs', () => {
  it('caps backoff at the last tier', () => {
    expect(titlePointRetryDelayMs(1)).toBe(30_000);
    expect(titlePointRetryDelayMs(99)).toBe(600_000);
  });
});
