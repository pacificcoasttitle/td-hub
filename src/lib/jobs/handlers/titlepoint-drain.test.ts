import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  findActiveMock,
  reclaimMock,
  claimMock,
  processWorkMock,
  updateSetMock,
  updateWhereMock,
} = vi.hoisted(() => ({
  findActiveMock: vi.fn(),
  reclaimMock: vi.fn(),
  claimMock: vi.fn(),
  processWorkMock: vi.fn(),
  updateSetMock: vi.fn(),
  updateWhereMock: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  db: {
    update: vi.fn(() => ({
      set: (vals: unknown) => {
        updateSetMock(vals);
        return { where: updateWhereMock };
      },
    })),
  },
}));

vi.mock('@/lib/db/schema', () => ({
  jobs: { id: 'jobs.id' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...a: unknown[]) => a),
}));

vi.mock('@/lib/domain/titlepoint/process-work', () => ({
  processTitlePointWork: (...a: unknown[]) => processWorkMock(...a),
}));

vi.mock('./titlepoint-drain-claim', () => ({
  TITLEPOINT_DRAIN_RUNNING_WINDOW_MS: 600_000,
  findActiveTitlePointDrain: (...a: unknown[]) => findActiveMock(...a),
  reclaimStaleTitlePointPollJobs: (...a: unknown[]) => reclaimMock(...a),
  claimTitlePointPollJobs: (...a: unknown[]) => claimMock(...a),
}));

import { handleTitlePointDrain } from './titlepoint-drain';

describe('handleTitlePointDrain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateWhereMock.mockResolvedValue(undefined);
    findActiveMock.mockResolvedValue(null);
    reclaimMock.mockResolvedValue(0);
    claimMock.mockResolvedValue([]);
  });

  it('single-flight skips when another drain is active', async () => {
    findActiveMock.mockResolvedValue({ id: 999 });

    const result = await handleTitlePointDrain({ __jobId: 1000 });

    expect(result.singleFlightSkipped).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.runningJobId).toBe(999);
    expect(claimMock).not.toHaveBeenCalled();
    expect(processWorkMock).not.toHaveBeenCalled();
  });

  it('claims and processes pending jobs', async () => {
    claimMock.mockResolvedValue([
      {
        id: 1,
        order_id: 50,
        payload: { titlePointDataId: 11 },
        attempts: 1,
        max_attempts: 5,
      },
    ]);
    processWorkMock.mockResolvedValue({ status: 'completed', documentId: 9 });

    const result = await handleTitlePointDrain({ __jobId: 200 });

    expect(reclaimMock).toHaveBeenCalled();
    expect(claimMock).toHaveBeenCalled();
    expect(processWorkMock).toHaveBeenCalledWith(11);
    expect(result.claimed).toBe(1);
    expect(result.completed).toBe(1);
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'completed' }),
    );
  });

  it('retries failed work with backoff until attempt cap', async () => {
    claimMock.mockResolvedValue([
      {
        id: 2,
        order_id: 50,
        payload: { titlePointDataId: 12 },
        attempts: 2,
        max_attempts: 5,
      },
    ]);
    processWorkMock.mockResolvedValue({ status: 'failed', error: 'Image request failed' });

    const result = await handleTitlePointDrain({});

    expect(result.retrying).toBe(1);
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'retrying', nextRetryAt: expect.any(Date) }),
    );
  });

  it('marks permanently failed when attempts reach max', async () => {
    claimMock.mockResolvedValue([
      {
        id: 3,
        order_id: 50,
        payload: { titlePointDataId: 13 },
        attempts: 5,
        max_attempts: 5,
      },
    ]);
    processWorkMock.mockResolvedValue({ status: 'failed', error: 'hard fail' });

    const result = await handleTitlePointDrain({});

    expect(result.failed).toBe(1);
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' }),
    );
  });

  it('isolates failures — one bad job does not block the next', async () => {
    claimMock.mockResolvedValue([
      {
        id: 4,
        order_id: 1,
        payload: { titlePointDataId: 21 },
        attempts: 1,
        max_attempts: 5,
      },
      {
        id: 5,
        order_id: 2,
        payload: { titlePointDataId: 22 },
        attempts: 1,
        max_attempts: 5,
      },
    ]);
    processWorkMock
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ status: 'completed' });

    const result = await handleTitlePointDrain({});

    expect(processWorkMock).toHaveBeenCalledTimes(2);
    expect(result.completed).toBe(1);
    expect(result.retrying).toBe(1);
  });
});

describe('claimTitlePointPollJobs SQL', () => {
  it('uses FOR UPDATE SKIP LOCKED', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(
      join(process.cwd(), 'src/lib/jobs/handlers/titlepoint-drain-claim.ts'),
      'utf8',
    );
    expect(src).toContain('FOR UPDATE SKIP LOCKED');
    expect(src).toContain("status IN ('queued', 'retrying')");
  });
});
