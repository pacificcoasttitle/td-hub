// Deadline-aware guard for batch jobs.
//
// WHY: Vercel terminates a function at its maxDuration (300s for the job
// runner). A batch job that keeps claiming work until the ceiling is killed
// mid-execution, so the handler never writes its terminal status and the row
// sits at 'running' until the watchdog reaps it ten minutes later. That is the
// cause of the 184 enrich_orders and 95 sync_all_contacts kills — not a
// database hang. See docs/db-timeout-findings.md.
//
// The fix is to stop claiming NEW work before the ceiling, return what was
// finished, and let the next scheduled run resume. Each job already selects the
// next N unprocessed rows, so resuming is free.
//
// SIZING: the budget is NOT a flat number. Checking the clock at 240s and then
// claiming a unit that takes 90s still lands past 300s. The budget must leave
// room for one more worst-case unit:
//
//     budget = FUNCTION_CEILING - p99_single_unit - safety_margin
//
// so the per-job budgets differ, and each is derived from measured per-unit
// durations rather than per-job durations.

/** Vercel maxDuration for the job runner (src/app/api/jobs/run/route.ts). */
export const FUNCTION_CEILING_MS = 300_000;

/** Absorbs cold start, the final DB writes, and clock imprecision. */
export const SAFETY_MARGIN_MS = 30_000;

/**
 * Measured p99 duration of a single unit of work, per job, from
 * vendor_api_logs over 30 days. A "unit" is everything done for one row —
 * including any inline external calls.
 */
export const UNIT_P99_MS = {
  /**
   * One order: get_attached_documents (p99 4.5s) or, on Title & Escrow,
   * get_attached_documents_prelim (p99 8.6s over 1,412 calls / 30 days) plus,
   * per document, an S3 ingest and an INLINE TESSA analysis — tessa_extract
   * p99 62.6s and tessa_summarize p99 12.1s. TESSA still dominates; the
   * slower prelim endpoint does not change the 90s unit. The run already
   * stops before the next order when the 180s budget is gone, so a 50-order
   * cap is a ceiling, not a promise to finish 50.
   */
  'softpro.fetch_prelims': 90_000,
  /** One order: get_order_contacts, p99 31.9s, observed max 60s (client timeout). */
  'softpro.enrich_orders': 60_000,
  /**
   * One order from the trailing-window sync. Already-known orders cost a single
   * DB lookup, but a NEW order pulls get_order_contacts (max 60s, the client
   * timeout) and then a sitex property_lookup (observed max 23.5s) inline, so the
   * worst case is the sum of both rather than either alone.
   */
  'softpro.sync_recent_orders': 90_000,
  /** One order: get_order_details, p99 6.4s, observed max 120s (client timeout). */
  'softpro.enrich_order_details': 60_000,
  /** One document: upload_document, p99 60s (client timeout). */
  'softpro.retry_document_attach': 60_000,
  /** One order: sitex property_lookup, p99 12.1s, observed max 23.5s. */
  'sitex.backfill_property': 25_000,
  /**
   * One order: a get_order_details call the drift detector caps at 30s itself,
   * plus its 250ms inter-call delay. Unlike the other entries this worst case is
   * enforced rather than observed — the detector races each call against its own
   * timeout precisely so a hung request cannot blow the budget.
   */
  'softpro.verify_sync': 31_000,
  /**
   * One order: a get_order_details call this job caps at 30s itself, plus the
   * 250ms inter-call delay and the processOrderDetail write.
   *
   * Enforced rather than observed, same as verify_sync — and here that matters
   * more, because the observed tail is severe: over 4,330 calls in 7 days,
   * p50 2.2s but p95 21s, p99 42s, max 65s. Sizing this off the median would
   * put the run past the ceiling on any bad vendor day.
   */
  'softpro.lookback_sync': 31_000,
  /**
   * One GetLookuptable page of the resumable contact sync: the fetch, capped at
   * LOOKUP_PAGE_TIMEOUT_MS (120s) by the client, plus processing the page — one
   * SELECT for its codes and the few writes that differ. Observed fetch 65-95s.
   * At 125s the budget is 145s, so a run normally starts three pages.
   */
  'softpro.sync_contacts_page': 125_000,
} as const;

export type BudgetedJob = keyof typeof UNIT_P99_MS;

export function budgetMsFor(job: BudgetedJob): number {
  return FUNCTION_CEILING_MS - UNIT_P99_MS[job] - SAFETY_MARGIN_MS;
}

export interface Deadline {
  /** True once there is no longer room for another worst-case unit. */
  exceeded(): boolean;
  elapsedMs(): number;
  remainingMs(): number;
  budgetMs: number;
}

/**
 * Creates a deadline for a job. Call `exceeded()` at the TOP of each loop
 * iteration — before claiming the next unit, never in the middle of one.
 */
export function createDeadline(job: BudgetedJob, now: () => number = Date.now): Deadline {
  const startedAt = now();
  const budgetMs = budgetMsFor(job);
  return {
    budgetMs,
    elapsedMs: () => now() - startedAt,
    remainingMs: () => Math.max(0, budgetMs - (now() - startedAt)),
    exceeded: () => now() - startedAt >= budgetMs,
  };
}

/** Shape returned by a job that may stop early. */
export interface PartialBatch {
  /** True when the loop stopped because the budget ran out, not because work ran out. */
  stoppedEarly: boolean;
  /** Units left unclaimed in this run; they are picked up next run. */
  remaining: number;
}

export function partialBatch(stoppedEarly: boolean, remaining: number): PartialBatch {
  return { stoppedEarly, remaining: stoppedEarly ? remaining : 0 };
}
