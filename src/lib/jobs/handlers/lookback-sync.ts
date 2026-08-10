import { db } from '@/lib/db/client';
import { jobs } from '@/lib/db/schema';
import { eq, sql } from 'drizzle-orm';
import { getOrderDetails } from '@/lib/integrations/softpro';
import { processOrderDetail } from '@/lib/domain/orders/process-detail';
import {
  accumulate,
  bandFor,
  correctionPct,
  diffOrder,
  emptyCounts,
  LOOKBACK_MAX_AGE_DAYS,
  LOOKBACK_MIN_AGE_DAYS,
  LOOKBACK_NOTE_PREFIX,
  LOOKBACK_STATUS_SOURCE,
  type LookbackBand,
  type LookbackCounts,
  type LookbackOrderRow,
} from '@/lib/domain/orders/lookback-diff';
import { createDeadline } from '@/lib/jobs/time-budget';

// ─── Order look-back sync ───────────────────────────────────────────────────
//
// Re-fetches GetOrderDetails for orders the ongoing sync can no longer reach,
// and corrects them. See docs/lookback-sync-design.md.
//
// WHY THIS EXISTS. Two gaps with one root cause — nothing re-reads an order
// after it is enriched:
//   (a) the hourly sync queries GetOrders(today, today), an OPEN-DATE window, so
//       an order that closes months after it opens is never returned again;
//   (b) enrich_order_details is gated on MISSING data, so a fully-enriched order
//       permanently drops out of the only path that could refresh it.
//
// SAFE BY CONSTRUCTION — no client-facing message can fire from this job.
// processOrderDetail imports no notification module, writes four tables, and
// performs no event_outbox insert. Confirmation emails come only from TitlePoint
// paths; prelim delivery has exactly one caller (prelim document ingest). No
// cron reacts to a status transition — the three that read operational_status
// use it as an INCLUSION filter, so closing an order removes it from their
// scope. The suppression is structural, not configured.
//
// The one visible consequence is handled here: history rows carry the
// LOOKBACK_NOTE_PREFIX marker and the dashboard activity feed excludes them, so
// a bulk correction cannot bury days of real activity. (The marker lives in
// `notes` rather than a dedicated `source` value because status_change_source
// is an enum that cannot be extended without a migration — see
// LOOKBACK_STATUS_SOURCE.)

export const PER_CALL_TIMEOUT_MS = 30_000;
export const CONCURRENCY = 3;
export const INTER_CALL_DELAY_MS = 250;

/**
 * Upper bound on orders claimed per run. The deadline stops the run long before
 * this in practice (~150-250 at measured latency); this only bounds the initial
 * SELECT so one run cannot pull the whole window into memory.
 */
export const BATCH_SIZE = 400;

export interface LookbackSyncResult extends LookbackCounts {
  dryRun: boolean;
  correctionPct: number | null;
  /** Order id to resume from next run; null once the window is exhausted. */
  nextCursorId: number | null;
  /** Claimed but not attempted because the budget ran out. */
  remaining: number;
  stoppedEarly: boolean;
  /** True when this run reached the end of the window and the cursor reset. */
  windowComplete: boolean;
  windowDays: { min: number; max: number };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Races a call against a timeout. The request is abandoned rather than
 * cancelled — the SoftPro client owns its socket — but the run moves on, which
 * is the property that matters. At most CONCURRENCY are ever outstanding.
 */
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | { __timedOut: true }> {
  return Promise.race([p, sleep(ms).then(() => ({ __timedOut: true }) as const)]);
}

/**
 * Reads the resume point from the last run's own `jobs` row.
 *
 * The cursor lives in the job payload rather than a new orders column, so this
 * needs no migration. The runner does not persist handler return values, so the
 * previous run wrote it back onto its row (see recordRun) and we read it here.
 */
async function readCursor(): Promise<number> {
  try {
    const rows = await db.execute(sql`
      select (payload->'lookbackSync'->>'nextCursorId') as cursor
      from jobs
      where job_type = 'softpro.lookback_sync'
        and payload->'lookbackSync'->>'nextCursorId' is not null
      order by id desc
      limit 1
    `) as unknown as Array<{ cursor: string | null }>;
    const raw = rows[0]?.cursor;
    const n = raw === null || raw === undefined ? 0 : Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    // A cursor we cannot read means starting the window again — wasteful but
    // never wrong, since every unit is idempotent.
    return 0;
  }
}

/**
 * Claims the next slice of the window, ordered by id so the cursor is a simple
 * high-water mark.
 *
 * `opened_at` bounds are inclusive-of-band: >= 30 days and < 180 days old.
 */
async function claimOrders(cursorId: number, limit: number): Promise<LookbackOrderRow[]> {
  const rows = await db.execute(sql`
    select id, file_number, operational_status, sales_price, loan_amount,
           extract(epoch from (now() - opened_at)) / 86400 as age_days
    from orders
    where operational_status = 'in_process'
      and opened_at is not null
      and opened_at <= now() - (${LOOKBACK_MIN_AGE_DAYS} * interval '1 day')
      and opened_at >  now() - (${LOOKBACK_MAX_AGE_DAYS} * interval '1 day')
      and id > ${cursorId}
    order by id
    limit ${limit}
  `) as unknown as Array<{
    id: number; file_number: string; operational_status: string | null;
    sales_price: string | null; loan_amount: string | null; age_days: string | number;
  }>;

  return rows.map((r) => ({
    id: r.id,
    fileNumber: r.file_number,
    operationalStatus: r.operational_status,
    salesPrice: r.sales_price,
    loanAmount: r.loan_amount,
    band: bandFor(Number(r.age_days)) as LookbackBand,
  }));
}

export interface LookbackSyncPayload {
  /** When true, compute what WOULD change and write nothing. */
  dryRun?: boolean;
  /** Explicit resume point; overrides the stored cursor. */
  cursorId?: number;
  /** Cap for this run; defaults to BATCH_SIZE. */
  limit?: number;
  __jobId?: number;
}

export async function handleLookbackSync(
  payload: Record<string, unknown> = {},
): Promise<LookbackSyncResult> {
  const input = payload as LookbackSyncPayload;
  const dryRun = input.dryRun === true;
  const limit = typeof input.limit === 'number' && input.limit > 0
    ? Math.min(input.limit, BATCH_SIZE)
    : BATCH_SIZE;

  const startCursor = typeof input.cursorId === 'number' ? input.cursorId : await readCursor();
  const claimed = await claimOrders(startCursor, limit);
  const deadline = createDeadline('softpro.lookback_sync');

  const counts = emptyCounts();
  let stoppedEarly = false;
  let attempted = 0;
  /** Highest id fully processed — only advanced past finished units. */
  let highWater = startCursor;

  let cursor = 0;
  async function worker() {
    for (;;) {
      // Checked before claiming the next order, never mid-unit, so there is
      // always room for one worst-case unit inside the 300s ceiling.
      if (deadline.exceeded()) {
        stoppedEarly = true;
        return;
      }
      const index = cursor++;
      if (index >= claimed.length) return;
      const order = claimed[index]!;
      attempted++;

      const raced = await withTimeout(
        getOrderDetails({ dateFrom: '', orderNumber: order.fileNumber, orderId: order.id })
          .catch(() => null),
        PER_CALL_TIMEOUT_MS,
      );

      const timedOut = raced === null || (raced as { __timedOut?: true }).__timedOut === true;
      const result = timedOut ? null : (raced as Awaited<ReturnType<typeof getOrderDetails>>);
      const detail = result?.success && result.data
        ? (result.data.find((d) => d.OrderNumber === order.fileNumber) ?? null)
        : null;

      const diff = diffOrder(order, detail);
      accumulate(counts, order.band, diff);

      // Only write when the diff is usable. An unreadable order is left exactly
      // as it was — we did not learn that it is correct, only that we could not
      // check it.
      if (!dryRun && diff.usable && detail) {
        try {
          await processOrderDetail(detail, {
            // Blank vendor fields omit the column instead of nulling it, so a
            // partial record can never erase good local data.
            preserveExistingOnEmpty: true,
            statusHistorySource: LOOKBACK_STATUS_SOURCE,
            statusHistoryNotePrefix: LOOKBACK_NOTE_PREFIX,
          });
        } catch (err) {
          console.error('[lookback-sync] write failed', {
            orderId: order.id, fileNumber: order.fileNumber,
            message: err instanceof Error ? err.message : err,
          });
        }
      }

      // Advance only after the unit is finished, so a budget stop never leaves
      // an order behind the cursor unprocessed.
      if (order.id > highWater) highWater = order.id;
      await sleep(INTER_CALL_DELAY_MS);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, claimed.length) }, () => worker()),
  );

  // Fewer rows than asked for and no early stop means the window is exhausted:
  // reset so the next run sweeps it again from the start.
  const windowComplete = !stoppedEarly && claimed.length < limit;

  const result: LookbackSyncResult = {
    ...counts,
    dryRun,
    correctionPct: correctionPct(counts),
    nextCursorId: windowComplete ? null : highWater,
    remaining: claimed.length - attempted,
    stoppedEarly,
    windowComplete,
    windowDays: { min: LOOKBACK_MIN_AGE_DAYS, max: LOOKBACK_MAX_AGE_DAYS },
  };

  await recordRun(payload, result);
  return result;
}

/**
 * Persists counts and the resume point onto this job's own `jobs` row.
 *
 * Same approach as the drift detector: the runner stores only the input
 * payload, so a job that needs to trend itself — or resume itself — writes back
 * here. Touches no order data. Failure must never fail the run.
 */
async function recordRun(
  payload: Record<string, unknown>,
  result: LookbackSyncResult,
): Promise<void> {
  const jobId = typeof payload.__jobId === 'number' ? payload.__jobId : null;
  if (jobId === null) return;
  try {
    await db
      .update(jobs)
      .set({ payload: { ...payload, __jobId: undefined, lookbackSync: result } })
      .where(eq(jobs.id, jobId));
  } catch {
    /* trending and resumption are best-effort; never fail the run over them */
  }
}
