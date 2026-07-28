import { db } from '@/lib/db/client';
import { jobs } from '@/lib/db/schema';
import { sql } from 'drizzle-orm';
import {
  TITLEPOINT_DRAIN_JOB_TYPE,
  TITLEPOINT_POLL_JOB_TYPE,
} from '@/lib/domain/titlepoint/poll-queue';

export const TITLEPOINT_DRAIN_RUNNING_WINDOW_MS = 10 * 60 * 1000;
const STALE_RUNNING_MS = 5 * 60 * 1000;

export interface ClaimedTitlePointJob {
  id: number;
  order_id: number | null;
  payload: { titlePointDataId?: number } | null;
  attempts: number;
  max_attempts: number;
}

/**
 * Single-flight: skip if another titlepoint.drain run is already active.
 */
export async function findActiveTitlePointDrain(
  currentJobId: number | null = null,
): Promise<{ id: number } | null> {
  const activeSince = new Date(Date.now() - TITLEPOINT_DRAIN_RUNNING_WINDOW_MS).toISOString();
  const idFilter = currentJobId === null
    ? sql``
    : sql`AND ${jobs.id} < ${currentJobId}`;

  const [runningJob] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(sql`
      ${jobs.status} = 'running'
      AND ${jobs.jobType} = ${TITLEPOINT_DRAIN_JOB_TYPE}
      AND ${jobs.startedAt} >= ${activeSince}
      ${idFilter}
    `)
    .limit(1);

  return runningJob ?? null;
}

/**
 * Reclaim titlepoint.poll rows stuck in running (function killed mid-work).
 * Marks retryable when under attempt cap — never leaves a phantom queue.
 */
export async function reclaimStaleTitlePointPollJobs(): Promise<number> {
  const staleBefore = new Date(Date.now() - STALE_RUNNING_MS);
  const result = await db.execute(sql`
    UPDATE jobs
    SET
      status = CASE
        WHEN attempts >= max_attempts THEN 'failed'::job_status
        ELSE 'retrying'::job_status
      END,
      next_retry_at = CASE
        WHEN attempts >= max_attempts THEN next_retry_at
        ELSE NOW()
      END,
      error = 'Reclaimed stale running titlepoint.poll (timeout) — retryable',
      ended_at = CASE
        WHEN attempts >= max_attempts THEN COALESCE(ended_at, NOW())
        ELSE NULL
      END
    WHERE job_type = ${TITLEPOINT_POLL_JOB_TYPE}
      AND status = 'running'
      AND started_at IS NOT NULL
      AND started_at < ${staleBefore.toISOString()}::timestamp
    RETURNING id
  `);
  return (result as unknown as Array<{ id: number }>).length;
}

/**
 * Atomically claim pending titlepoint.poll jobs (FOR UPDATE SKIP LOCKED).
 */
export async function claimTitlePointPollJobs(limit: number): Promise<ClaimedTitlePointJob[]> {
  const result = await db.execute(sql`
    UPDATE jobs
    SET
      status = 'running',
      started_at = NOW(),
      attempts = attempts + 1,
      error = NULL
    WHERE id IN (
      SELECT id FROM jobs
      WHERE job_type = ${TITLEPOINT_POLL_JOB_TYPE}
        AND status IN ('queued', 'retrying')
        AND (next_retry_at IS NULL OR next_retry_at <= NOW())
        AND attempts < max_attempts
      ORDER BY coalesce(next_retry_at, created_at) ASC, id ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    RETURNING id, order_id, payload, attempts, max_attempts
  `);

  return result as unknown as ClaimedTitlePointJob[];
}
