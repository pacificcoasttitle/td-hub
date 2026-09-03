/**
 * Cron drain for Update Prelim.
 *
 * The route accepts the upload, writes a queued job row and returns, because
 * three sequential SoftPro calls do not fit inside Vercel's 300s ceiling and a
 * timeout mid-flight is what produced duplicate vendor work before.
 *
 * The claim is atomic (FOR UPDATE SKIP LOCKED + status flip in one statement),
 * so two overlapping cron runs cannot both take the same job. Per-step
 * progress lives on the job payload, so a retry resumes instead of re-posting
 * a note that is already on the file.
 */

import { db } from '@/lib/db/client';
import { jobs } from '@/lib/db/schema';
import { eq, sql } from 'drizzle-orm';
import { UPDATE_PRELIM_JOB_TYPE } from '@/lib/domain/prelim/update-prelim';
import { handleUpdatePrelim } from './update-prelim';

const DEFAULT_BATCH_LIMIT = 3;
const DEFAULT_TIME_BUDGET_MS = 240_000;

/** A run killed mid-work leaves status='running'; reclaim after this. */
const STALE_RUNNING_MS = 5 * 60 * 1000;

const RETRY_BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000];

export interface ClaimedUpdatePrelimJob {
  id: number;
  order_id: number | null;
  payload: Record<string, unknown> | null;
  attempts: number;
  max_attempts: number;
}

export interface UpdatePrelimDrainResult {
  claimed: number;
  completed: number;
  failed: number;
  retrying: number;
  errors: Array<{ jobId: number; error: string }>;
}

function batchLimit(): number {
  const raw = process.env.UPDATE_PRELIM_DRAIN_BATCH_SIZE;
  const n = raw ? Number.parseInt(raw, 10) : DEFAULT_BATCH_LIMIT;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_BATCH_LIMIT;
}

function timeBudgetMs(): number {
  const raw = process.env.UPDATE_PRELIM_DRAIN_TIME_BUDGET_MS;
  const n = raw ? Number.parseInt(raw, 10) : DEFAULT_TIME_BUDGET_MS;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIME_BUDGET_MS;
}

export function updatePrelimNextRetryAt(attempts: number, from = new Date()): Date {
  const idx = Math.min(Math.max(attempts - 1, 0), RETRY_BACKOFF_MS.length - 1);
  return new Date(from.getTime() + RETRY_BACKOFF_MS[idx]!);
}

export async function reclaimStaleUpdatePrelimJobs(): Promise<number> {
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
      error = 'Reclaimed stale running prelim.update (timeout) — retryable',
      ended_at = CASE
        WHEN attempts >= max_attempts THEN COALESCE(ended_at, NOW())
        ELSE NULL
      END
    WHERE job_type = ${UPDATE_PRELIM_JOB_TYPE}
      AND status = 'running'
      AND started_at IS NOT NULL
      AND started_at < ${staleBefore.toISOString()}::timestamp
    RETURNING id
  `);
  return (result as unknown as Array<{ id: number }>).length;
}

export async function claimUpdatePrelimJobs(limit: number): Promise<ClaimedUpdatePrelimJob[]> {
  const result = await db.execute(sql`
    UPDATE jobs
    SET
      status = 'running',
      started_at = NOW(),
      attempts = attempts + 1,
      error = NULL
    WHERE id IN (
      SELECT id FROM jobs
      WHERE job_type = ${UPDATE_PRELIM_JOB_TYPE}
        AND status IN ('queued', 'retrying')
        AND (next_retry_at IS NULL OR next_retry_at <= NOW())
        AND attempts < max_attempts
      ORDER BY coalesce(next_retry_at, created_at) ASC, id ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    RETURNING id, order_id, payload, attempts, max_attempts
  `);

  return result as unknown as ClaimedUpdatePrelimJob[];
}

async function settleJob(
  job: ClaimedUpdatePrelimJob,
  outcome: 'completed' | 'failed' | 'retrying',
  error?: string,
): Promise<void> {
  if (outcome === 'completed') {
    await db.update(jobs).set({
      status: 'completed',
      endedAt: new Date(),
      error: null,
      nextRetryAt: null,
    }).where(eq(jobs.id, job.id));
    return;
  }

  if (outcome === 'retrying' && job.attempts < job.max_attempts) {
    await db.update(jobs).set({
      status: 'retrying',
      error: error ?? 'retryable failure',
      nextRetryAt: updatePrelimNextRetryAt(job.attempts),
      endedAt: null,
    }).where(eq(jobs.id, job.id));
    return;
  }

  await db.update(jobs).set({
    status: 'failed',
    error: error ?? 'failed after max attempts',
    endedAt: new Date(),
    nextRetryAt: null,
  }).where(eq(jobs.id, job.id));
}

export async function handleUpdatePrelimDrain(): Promise<UpdatePrelimDrainResult> {
  await reclaimStaleUpdatePrelimJobs();

  const claimed = await claimUpdatePrelimJobs(batchLimit());
  const started = Date.now();
  const budgetMs = timeBudgetMs();

  let completed = 0;
  let failed = 0;
  let retrying = 0;
  const errors: UpdatePrelimDrainResult['errors'] = [];

  for (const job of claimed) {
    if (Date.now() - started > budgetMs) {
      await settleJob(job, 'retrying', 'Drain time budget exhausted before processing');
      retrying++;
      continue;
    }

    try {
      const result = await handleUpdatePrelim({
        ...(job.payload ?? {}),
        __jobId: job.id,
      });

      // The email is the only step allowed to fail without failing the run:
      // the prelim is attached and the task is open, so the operator's work is
      // done and a human can see it in SoftPro.
      if (!result.email.ok) {
        await settleJob(job, 'retrying', `email not sent: ${result.email.detail}`);
        if (job.attempts >= job.max_attempts) failed++;
        else retrying++;
        errors.push({ jobId: job.id, error: `email: ${result.email.detail}` });
        continue;
      }

      await settleJob(job, 'completed');
      completed++;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Update Prelim work threw';
      await settleJob(job, 'retrying', message);
      if (job.attempts >= job.max_attempts) failed++;
      else retrying++;
      errors.push({ jobId: job.id, error: message });
    }
  }

  return { claimed: claimed.length, completed, failed, retrying, errors };
}
