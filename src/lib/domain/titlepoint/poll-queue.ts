import { db } from '@/lib/db/client';
import { jobs, titlePointData } from '@/lib/db/schema';
import { eq, sql } from 'drizzle-orm';

/** Brief post-submit attempt before handing unfinished work to the drain cron. */
export const TITLEPOINT_SHORT_SYNC_MS = 3_000;

/** Don't start fetchImage unless at least this much short-sync budget remains. */
export const TITLEPOINT_MIN_IMAGE_BUDGET_MS = 2_000;

export const TITLEPOINT_POLL_JOB_TYPE = 'titlepoint.poll';
export const TITLEPOINT_DRAIN_JOB_TYPE = 'titlepoint.drain';

export const TITLEPOINT_POLL_MAX_ATTEMPTS = 5;

const BACKOFF_MS = [30_000, 60_000, 120_000, 300_000, 600_000] as const;

export function titlePointRetryDelayMs(attempt: number): number {
  const idx = Math.max(0, Math.min(BACKOFF_MS.length - 1, attempt - 1));
  return BACKOFF_MS[idx]!;
}

export function titlePointNextRetryAt(attempt: number, now = new Date()): Date {
  return new Date(now.getTime() + titlePointRetryDelayMs(attempt));
}

/**
 * Enqueue a titlepoint.poll job for background drain.
 * Idempotent: skips when the search is already completed or an active job exists.
 */
export async function enqueueTitlePointPollJob(opts: {
  titlePointDataId: number;
  orderId?: number | null;
}): Promise<{ enqueued: boolean; jobId: number | null; reason?: string }> {
  const [record] = await db
    .select({
      id: titlePointData.id,
      status: titlePointData.status,
      orderId: titlePointData.orderId,
    })
    .from(titlePointData)
    .where(eq(titlePointData.id, opts.titlePointDataId))
    .limit(1);

  if (!record) {
    return { enqueued: false, jobId: null, reason: 'title_point_data_not_found' };
  }
  if (record.status === 'completed') {
    return { enqueued: false, jobId: null, reason: 'already_completed' };
  }

  const orderId = opts.orderId ?? record.orderId ?? null;

  const existing = await db.execute(sql`
    SELECT id
    FROM jobs
    WHERE job_type = ${TITLEPOINT_POLL_JOB_TYPE}
      AND status IN ('queued', 'retrying', 'running')
      AND (payload->>'titlePointDataId')::int = ${opts.titlePointDataId}
    ORDER BY id DESC
    LIMIT 1
  `);

  const existingRows = existing as unknown as Array<{ id: number }>;
  if (existingRows.length > 0) {
    return { enqueued: false, jobId: existingRows[0]!.id, reason: 'active_job_exists' };
  }

  const [job] = await db
    .insert(jobs)
    .values({
      jobType: TITLEPOINT_POLL_JOB_TYPE,
      orderId,
      payload: { titlePointDataId: opts.titlePointDataId } as Record<string, unknown>,
      status: 'queued',
      attempts: 0,
      maxAttempts: TITLEPOINT_POLL_MAX_ATTEMPTS,
      nextRetryAt: new Date(),
    })
    .returning({ id: jobs.id });

  return { enqueued: true, jobId: job!.id };
}
