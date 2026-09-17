import { db } from '@/lib/db/client';
import { jobs } from '@/lib/db/schema';
import { sql, and, eq, lt } from 'drizzle-orm';
import { runJobHealthCheck, type JobHealthCheckResult } from '@/lib/domain/ops/job-health';

export interface JobsWatchdogResult {
  staleJobsFound: number;
  staleJobsByType: Record<string, number>;
  /** The reader: which jobs are failing or stalled, and whether anyone was told. */
  health: JobHealthCheckResult | null;
  /** A failure of the health check itself. Reported as "completed with errors". */
  errors: string[];
}

/**
 * The health check runs after reaping, so a job the watchdog just marked failed
 * counts. Its own failure never stops the reaping, and is returned in `errors`
 * so the run records as completed-with-errors and the daily summary reports it.
 */
async function checkHealth(): Promise<Pick<JobsWatchdogResult, 'health' | 'errors'>> {
  try {
    const health = await runJobHealthCheck();
    return { health, errors: health.sendError ? [`job health alert not sent: ${health.sendError}`] : [] };
  } catch (err) {
    return { health: null, errors: [`job health check failed: ${err instanceof Error ? err.message : String(err)}`] };
  }
}

const STALE_THRESHOLD_MS = 10 * 60 * 1000;

/**
 * Auto-fails any job stuck in 'running' state for >10 minutes.
 * Vercel functions max at 300s, so anything still 'running' past
 * 10 min is definitely orphaned (function killed without writing
 * the terminal status row).
 */
export async function handleJobsWatchdog(): Promise<JobsWatchdogResult> {
  const staleThreshold = new Date(Date.now() - STALE_THRESHOLD_MS);

  const staleJobs = await db
    .select({
      id: jobs.id,
      jobType: jobs.jobType,
      createdAt: jobs.createdAt,
    })
    .from(jobs)
    .where(and(
      eq(jobs.status, 'running'),
      lt(jobs.createdAt, staleThreshold),
    ));

  if (staleJobs.length === 0) {
    return { staleJobsFound: 0, staleJobsByType: {}, ...(await checkHealth()) };
  }

  await db.update(jobs)
    .set({
      status: 'failed',
      error: 'Watchdog: job stuck in running state >10min, presumed timeout',
      endedAt: sql`COALESCE(${jobs.endedAt}, NOW())`,
    })
    .where(and(
      eq(jobs.status, 'running'),
      lt(jobs.createdAt, staleThreshold),
    ));

  const staleJobsByType: Record<string, number> = {};
  for (const job of staleJobs) {
    staleJobsByType[job.jobType] = (staleJobsByType[job.jobType] ?? 0) + 1;
  }

  console.warn(`[jobs-watchdog] Failed ${staleJobs.length} stuck jobs`, staleJobsByType);

  return {
    staleJobsFound: staleJobs.length,
    staleJobsByType,
    ...(await checkHealth()),
  };
}
