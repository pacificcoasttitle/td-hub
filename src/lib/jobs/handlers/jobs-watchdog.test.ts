import { beforeEach, describe, expect, it, vi } from 'vitest';

const { runJobHealthCheck, staleRows } = vi.hoisted(() => ({
  runJobHealthCheck: vi.fn(),
  staleRows: { value: [] as Array<{ id: number; jobType: string; createdAt: Date }> },
}));

vi.mock('@/lib/domain/ops/job-health', () => ({ runJobHealthCheck }));
vi.mock('@/lib/db/client', () => ({
  db: {
    select: () => ({ from: () => ({ where: async () => staleRows.value }) }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  },
}));

import { handleJobsWatchdog } from './jobs-watchdog';

const HEALTHY = { issues: [], opened: 0, reminded: 0, resolved: 0, emailed: false, recipients: 0, sendError: null };

describe('jobs.watchdog runs the reader', () => {
  beforeEach(() => {
    runJobHealthCheck.mockReset();
    staleRows.value = [];
  });

  it('includes the health check on every run', async () => {
    runJobHealthCheck.mockResolvedValue(HEALTHY);
    await expect(handleJobsWatchdog()).resolves.toMatchObject({ staleJobsFound: 0, health: HEALTHY, errors: [] });
  });

  it('runs it after reaping, when there were stuck jobs', async () => {
    staleRows.value = [{ id: 1, jobType: 'softpro.sync_contacts.lender', createdAt: new Date() }];
    runJobHealthCheck.mockResolvedValue(HEALTHY);
    await expect(handleJobsWatchdog()).resolves.toMatchObject({ staleJobsFound: 1, health: HEALTHY });
  });

  it('records a failing health check as an error instead of throwing, so reaping still counts', async () => {
    runJobHealthCheck.mockRejectedValue(new Error('relation "job_health_alerts" does not exist'));
    await expect(handleJobsWatchdog()).resolves.toMatchObject({
      health: null,
      errors: ['job health check failed: relation "job_health_alerts" does not exist'],
    });
  });

  it('records an alert that could not be sent', async () => {
    runJobHealthCheck.mockResolvedValue({ ...HEALTHY, opened: 1, sendError: 'ops.jobs.unhealthy is disabled or has no recipients' });
    await expect(handleJobsWatchdog()).resolves.toMatchObject({
      errors: ['job health alert not sent: ops.jobs.unhealthy is disabled or has no recipients'],
    });
  });
});
