import { db } from '@/lib/db/client';
import { jobs } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { processTitlePointWork } from '@/lib/domain/titlepoint/process-work';
import { titlePointNextRetryAt } from '@/lib/domain/titlepoint/poll-queue';
import {
  claimTitlePointPollJobs,
  findActiveTitlePointDrain,
  reclaimStaleTitlePointPollJobs,
  type ClaimedTitlePointJob,
} from './titlepoint-drain-claim';

export {
  TITLEPOINT_DRAIN_RUNNING_WINDOW_MS,
  claimTitlePointPollJobs,
  findActiveTitlePointDrain,
  reclaimStaleTitlePointPollJobs,
} from './titlepoint-drain-claim';

const DEFAULT_BATCH_LIMIT = 5;
const DEFAULT_TIME_BUDGET_MS = 240_000;

export interface TitlePointDrainResult {
  claimed: number;
  completed: number;
  failed: number;
  retrying: number;
  skipped: boolean;
  singleFlightSkipped: boolean;
  runningJobId: number | null;
  errors: Array<{ jobId: number; titlePointDataId: number; error: string }>;
}

function batchLimit(): number {
  const raw = process.env.TITLEPOINT_DRAIN_BATCH_SIZE;
  const n = raw ? Number.parseInt(raw, 10) : DEFAULT_BATCH_LIMIT;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_BATCH_LIMIT;
}

function timeBudgetMs(): number {
  const raw = process.env.TITLEPOINT_DRAIN_TIME_BUDGET_MS;
  const n = raw ? Number.parseInt(raw, 10) : DEFAULT_TIME_BUDGET_MS;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIME_BUDGET_MS;
}

async function settleJob(
  job: ClaimedTitlePointJob,
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
      nextRetryAt: titlePointNextRetryAt(job.attempts),
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

/**
 * Cron-driven TitlePoint drain: single-flight + atomic claim + process.
 * Runs the existing finish pipeline per claimed row; isolates failures.
 */
export async function handleTitlePointDrain(
  payload: Record<string, unknown> = {},
): Promise<TitlePointDrainResult> {
  const currentJobId = typeof payload.__jobId === 'number' ? payload.__jobId : null;
  const limit = batchLimit();
  const budgetMs = timeBudgetMs();

  const active = await findActiveTitlePointDrain(currentJobId);
  if (active) {
    return {
      claimed: 0,
      completed: 0,
      failed: 0,
      retrying: 0,
      skipped: true,
      singleFlightSkipped: true,
      runningJobId: active.id,
      errors: [],
    };
  }

  await reclaimStaleTitlePointPollJobs();

  const claimed = await claimTitlePointPollJobs(limit);
  const started = Date.now();
  let completed = 0;
  let failed = 0;
  let retrying = 0;
  const errors: TitlePointDrainResult['errors'] = [];

  for (const job of claimed) {
    if (Date.now() - started > budgetMs) {
      await settleJob(job, 'retrying', 'Drain time budget exhausted before processing');
      retrying++;
      continue;
    }

    const titlePointDataId = Number(
      (job.payload as { titlePointDataId?: unknown } | null)?.titlePointDataId,
    );
    if (!Number.isFinite(titlePointDataId) || titlePointDataId <= 0) {
      await settleJob(job, 'failed', 'Invalid titlePointDataId in job payload');
      failed++;
      errors.push({ jobId: job.id, titlePointDataId: 0, error: 'invalid payload' });
      continue;
    }

    try {
      const workStarted = Date.now();
      const result = await processTitlePointWork(titlePointDataId);
      const timedOut = Date.now() - workStarted > budgetMs;

      if (result.status === 'completed') {
        await settleJob(job, 'completed');
        completed++;
      } else if (result.status === 'pending' || result.requeued || timedOut) {
        await settleJob(
          job,
          'retrying',
          result.error ?? (timedOut ? 'Work timed out — retryable' : 'pending'),
        );
        retrying++;
      } else {
        await settleJob(job, 'retrying', result.error ?? 'processing failed');
        if (job.attempts >= job.max_attempts) {
          failed++;
        } else {
          retrying++;
        }
        errors.push({
          jobId: job.id,
          titlePointDataId,
          error: result.error ?? 'failed',
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'TitlePoint work threw';
      await settleJob(job, 'retrying', message);
      if (job.attempts >= job.max_attempts) failed++;
      else retrying++;
      errors.push({ jobId: job.id, titlePointDataId, error: message });
    }
  }

  return {
    claimed: claimed.length,
    completed,
    failed,
    retrying,
    skipped: false,
    singleFlightSkipped: false,
    runningJobId: currentJobId,
    errors,
  };
}
