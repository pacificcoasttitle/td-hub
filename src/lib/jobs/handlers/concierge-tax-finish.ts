import { and, asc, inArray, isNotNull } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { conciergeProfiles } from '@/lib/db/schema';
import { finishTaxDetail } from '@/lib/domain/concierge/tax-bridge';

// ─── The safety net for a paid-for tax search ───────────────────────────────
//
// WHY THIS EXISTS. Profile 9's tax search ran, its result was stored, and its
// PDF was never replaced — the PDF on file had been written five seconds before
// the search even started. The finishing work was a `void finishTaxDetail(...)`
// promise kicked off after the route had already answered, and a serverless
// function is free to freeze once it has answered. The database write survived;
// the render, which downloads the payload and lays out eight pages, did not.
//
// Nothing noticed, because the only thing that would have noticed was the same
// promise that died.
//
// ─── A SWEEPER, NOT A JOB ROW PER SEARCH ────────────────────────────────────
//
// The usual pattern here is an enqueued row claimed by a drain (titlepoint.poll
// and titlepoint.drain). This does not need it: `concierge_profiles` ALREADY
// records exactly what is outstanding — a status of 'pending' or 'fetched' with
// a titlepoint_data_id is the complete description of unfinished work. A job
// row would be a second copy of that, able to disagree with it, and would need
// its own claim, backoff and reconciliation to say the same thing.
//
// So this asks the table. It cannot drift from the truth because it IS the
// truth, and a profile that somehow never got a job row is still swept.
//
// ─── IT IS SAFE TO RUN OVER AND OVER ────────────────────────────────────────
//
// finishTaxDetail is idempotent and free: it polls a search that is already
// paid for, and re-renders from stored data. It cannot create a second search —
// routes.test.ts asserts createServicePreOrderTax does not appear in it. So the
// worst case of a double run is a wasted render, never a second charge.

export const CONCIERGE_TAX_FINISH_JOB_TYPE = 'concierge.tax_finish';

/** One run's ceiling. Each finish polls TitlePoint and may render a PDF. */
const DEFAULT_BATCH = 10;
const TIME_BUDGET_MS = 240_000;

/**
 * Old enough that the request which started it has certainly gone.
 *
 * Without this the sweeper races the foreground: an operator's own request is
 * finishing the same profile while this picks it up, and they both poll and
 * both render. Harmless but wasteful, and it muddies the logs for the next
 * person reading them.
 */
const SETTLE_MS = 30_000;

export interface ConciergeTaxFinishResult {
  considered: number;
  finished: number;
  stillWaiting: number;
  failed: number;
  outcomes: Array<{ profileId: number; status: string; message: string }>;
}

export async function handleConciergeTaxFinish(
  payload: Record<string, unknown> = {},
): Promise<ConciergeTaxFinishResult> {
  const limit = Number.isFinite(Number(payload.limit)) && Number(payload.limit) > 0
    ? Math.min(50, Math.floor(Number(payload.limit)))
    : DEFAULT_BATCH;

  const cutoff = new Date(Date.now() - SETTLE_MS);
  const deadline = Date.now() + TIME_BUDGET_MS;

  const rows = await db
    .select({
      id: conciergeProfiles.id,
      dataId: conciergeProfiles.titlePointDataId,
      requestId: conciergeProfiles.titlePointRequestId,
      requestedAt: conciergeProfiles.titlePointRequestedAt,
    })
    .from(conciergeProfiles)
    .where(and(
      // 'pending' — the search may still be running at TitlePoint.
      // 'fetched' — the result is in and the document does not show it yet.
      // Both are paid for; both finish for nothing.
      inArray(conciergeProfiles.taxDetailStatus, ['pending', 'fetched']),
      isNotNull(conciergeProfiles.titlePointDataId),
    ))
    .orderBy(asc(conciergeProfiles.titlePointRequestedAt))
    .limit(limit);

  const due = rows.filter((r) => !r.requestedAt || r.requestedAt <= cutoff);

  const out: ConciergeTaxFinishResult = {
    considered: due.length, finished: 0, stillWaiting: 0, failed: 0, outcomes: [],
  };

  for (const row of due) {
    if (Date.now() > deadline) break;
    if (!row.dataId) continue;
    try {
      const r = await finishTaxDetail(row.id, row.dataId, row.requestId);
      if (r.status === 'ready' || r.status === 'empty') out.finished += 1;
      else if (r.status === 'pending' || r.status === 'fetched') out.stillWaiting += 1;
      else out.failed += 1;
      out.outcomes.push({ profileId: row.id, status: r.status, message: r.message });
    } catch (err) {
      // One profile's failure must not strand the rest of the batch.
      out.failed += 1;
      out.outcomes.push({
        profileId: row.id,
        status: 'error',
        message: err instanceof Error ? err.message : 'finishTaxDetail threw',
      });
    }
  }

  return out;
}
