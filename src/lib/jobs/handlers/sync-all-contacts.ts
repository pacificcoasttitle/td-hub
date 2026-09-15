import { db } from '@/lib/db/client';
import { contactSyncState, jobs } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { createDeadline, FUNCTION_CEILING_MS } from '@/lib/jobs/time-budget';
import {
  describeSyncError,
  fetchSyncContactPage,
  fetchSyncContactRows,
  getSyncContactLookupCode,
  sortSyncContactRows,
  syncContactRows,
  type SyncContactEntityType,
  type SyncContactsResult,
} from './sync-contacts';

/** Sales Rep only: one request, synced whole, then left alone this long. */
const CONTACT_SYNC_COOLDOWN_MS = 16 * 60 * 60 * 1000;

// ─── THE CONTACT SYNC RESUMES ACROSS RUNS, ONE PAGE AT A TIME ───────────────
//
// SoftPro takes 65-95s to return one 1,000-row GetLookuptable page (all 16
// person pages read on 2026-09-15: average 70.8s, max 95.4s). The previous
// design fetched EVERY page before processing any, under a 60s per-request
// timeout and Vercel's 300s ceiling. It could not finish: `Order Contact -
// Person` last completed on 2026-09-03, and the lender, title officer, escrow
// officer and underwriter syncs failed the same way. Runs that "completed"
// in 0.0s were cooldown skips that fetched nothing.
//
// So a run reads pages from where the last one stopped, writes each, and
// advances the cursor after EACH page — a failure costs one page, not the run.
// A sweep that reaches TotalPages resets to page 1, and the next run starts the
// next sweep. See docs/tickets/RESUMABLE_CONTACT_SYNC.md.

/**
 * Hard cap on pages per run, whatever the clock says.
 *
 * The approved design said six pages per run against a ten-minute watchdog.
 * The real limit is the job route's 300s maxDuration, so the clock decides —
 * createDeadline('softpro.sync_contacts_page') stops starting pages after
 * 145s, which is normally three. Six stays as the ceiling on a fast day.
 */
export const MAX_PAGES_PER_RUN = 6;

/**
 * A run that started less than this long ago still owns its entity type.
 *
 * Two crons can reach the same type: its own `softpro.sync_contacts.<type>`
 * job and `softpro.sync_all_contacts`. With cursors that would be two runs
 * reading and advancing one sweep at once. A run cannot outlive the function
 * ceiling, so anything older than ceiling + a minute is a dead run whose
 * `running` status was never cleared, and is taken over.
 */
const RUN_OWNERSHIP_MS = FUNCTION_CEILING_MS + 60_000;

export const CONTACT_SYNC_JOB_CONFIGS = {
  'softpro.sync_contacts.order_contact_person': 'Order Contact - Person',
  'softpro.sync_contacts.title_officer': 'Title Officer',
  'softpro.sync_contacts.escrow_officer': 'Escrow Officer',
  'softpro.sync_contacts.sales_rep': 'Sales Rep',
  'softpro.sync_contacts.escrow_company': 'Escrow Company',
  'softpro.sync_contacts.lender': 'Lender',
  'softpro.sync_contacts.mortgage_broker': 'Mortgage Broker',
  'softpro.sync_contacts.selling_agent_broker': 'SellingAgentBroker',
  'softpro.sync_contacts.underwriter': 'Underwriter',
} as const satisfies Record<string, SyncContactEntityType>;

export interface SyncAllContactsResult {
  results: SyncContactsResult[];
  totalCreated: number;
  totalUpdated: number;
  totalErrors: number;
}

export interface SyncContactTypeResult extends SyncContactsResult {
  jobType: string;
  status: 'completed' | 'paused' | 'skipped';
  processed: number;
  /** The boundary code: last lookup code of the last page this sweep completed. */
  cursorLookupCode: string | null;
  nextAllowedAt: string | null;
  /** Pages read by this run. */
  pagesRead?: number;
  /** The page the next run starts at (1 when a sweep just finished). */
  nextPage?: number;
  totalPages?: number | null;
  sweepCompleted?: boolean;
  /** TotalRows fell during the sweep; a row may have been skipped until the next one. */
  driftSuspected?: boolean;
  /** Pages whose first code did not sort after the stored boundary: a harmless re-read. */
  boundaryShifts?: number;
  skipReason?: 'cooldown' | 'running';
}

export interface SyncContactTypePayload {
  /** Injected by the job runner so a partial failure can record itself. */
  __jobId?: number;
}

export interface SyncContactTypeDeps {
  /** Injectable clock, for the page deadline. */
  now?: () => number;
}

/**
 * One sentence naming who failed and why, short enough to live in `jobs.error`.
 *
 * A run where some rows failed and others succeeded returns normally, so the
 * runner marks the job `completed` and writes no error — indistinguishable from
 * a run that had nothing to do. That is how the escrow-officer sync reported
 * clean runs for four months while four officers silently stopped updating.
 */
export function summarizeSyncErrors(result: SyncContactsResult, processed: number): string {
  const names = result.errors.slice(0, 5).map((e) => e.lookupCode).join(', ');
  const more = result.errors.length > 5 ? ` (+${result.errors.length - 5} more)` : '';
  const rejected = result.rejected ?? [];
  // Named separately because the two need different responses: a failure is
  // ours to fix, a shape rejection is a malformed vendor row that only SoftPro
  // can fix, and the message has to say which one a reader is looking at.
  const shapeNote = rejected.length > 0
    ? ` ${rejected.length} of those were REJECTED FOR SHAPE and must be escalated to SoftPro: `
      + `${rejected.map((r) => r.lookupCode).join(', ')}.`
    : '';
  return `${result.entityType}: ${result.errors.length} of ${processed} rows failed — ${names}${more}.${shapeNote} `
    + `First: ${result.errors[0]?.error ?? 'unknown'}`;
}

/**
 * Puts a partial failure where the Operations panel already looks.
 *
 * `jobs.error` is the field `/api/admin/ops/sync` reads, and the runner only
 * ever writes it when a handler throws. This sync must not throw — one officer's
 * unique-violation is no reason to abandon the rest of the feed — so it stamps
 * its own row. `jobs.payload` also takes the full result, matching how
 * sync-orders, verify-order-sync and party-wizard-invite persist theirs.
 *
 * Best-effort: failing to record a failure must not itself fail the run.
 */
async function recordRun(
  payload: SyncContactTypePayload,
  response: SyncContactTypeResult,
): Promise<void> {
  const jobId = typeof payload.__jobId === 'number' ? payload.__jobId : null;
  if (jobId === null) return;
  try {
    await db
      .update(jobs)
      .set({
        payload: { ...payload, __jobId: undefined, syncContacts: response },
        ...(response.errors.length > 0
          ? { error: summarizeSyncErrors(response, response.processed) }
          : {}),
      })
      .where(eq(jobs.id, jobId));
  } catch {
    /* recording is best-effort; never fail the sync over it */
  }
}

export async function handleSyncAllContacts(): Promise<SyncAllContactsResult> {
  const now = new Date();
  const stateRows = await db.select().from(contactSyncState);
  const stateByType = new Map(stateRows.map((row) => [row.entityType, row]));
  const dueJob = Object.entries(CONTACT_SYNC_JOB_CONFIGS).find(([, entityType]) => {
    const state = stateByType.get(entityType);
    return !state?.nextAllowedAt || state.nextAllowedAt <= now;
  });

  if (!dueJob) {
    return { results: [], totalCreated: 0, totalUpdated: 0, totalErrors: 0 };
  }

  const result = await handleSyncContactType(dueJob[0] as keyof typeof CONTACT_SYNC_JOB_CONFIGS);
  return {
    results: [result],
    totalCreated: result.created,
    totalUpdated: result.updated,
    totalErrors: result.errors.length,
  };
}

type SyncState = typeof contactSyncState.$inferSelect;

function skippedResult(
  jobType: string,
  entityType: SyncContactEntityType,
  state: SyncState,
  skipReason: 'cooldown' | 'running',
): SyncContactTypeResult {
  return {
    jobType,
    entityType,
    status: 'skipped',
    skipReason,
    totalFetched: state.totalFetched,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    processed: 0,
    cursorLookupCode: state.cursorLookupCode,
    nextAllowedAt: state.nextAllowedAt?.toISOString() ?? null,
    nextPage: state.nextPage,
    totalPages: state.totalPages,
  };
}

/**
 * "Every row we tried to write failed" means something systemic — the
 * unique-index collision that broke four officers looked exactly like this.
 * Rows the shape guard declined were never attempted, so they are excluded
 * from both sides of the comparison. Counting them as attempts would let a
 * single permanently-malformed vendor row hold this job in `failed` forever,
 * and a rejection is an expected steady state until SoftPro fixes the feed.
 */
function assertNotSystemic(jobType: string, processed: number, result: SyncContactsResult): void {
  const rejectedCount = result.rejected?.length ?? 0;
  const attempted = processed - rejectedCount;
  const unexpectedFailures = result.errors.length - rejectedCount;
  if (attempted > 0 && result.created === 0 && result.updated === 0 && unexpectedFailures === attempted) {
    throw new Error(`${jobType}: ${attempted} attempts, 0 successes`);
  }
}

export async function handleSyncContactType(
  jobType: keyof typeof CONTACT_SYNC_JOB_CONFIGS,
  payload: SyncContactTypePayload = {},
  deps: SyncContactTypeDeps = {},
): Promise<SyncContactTypeResult> {
  const entityType = CONTACT_SYNC_JOB_CONFIGS[jobType];
  const now = deps.now ?? Date.now;
  const startedAt = new Date(now());
  const [state] = await db
    .select()
    .from(contactSyncState)
    .where(eq(contactSyncState.entityType, entityType))
    .limit(1);

  if (state?.nextAllowedAt && state.nextAllowedAt > startedAt) {
    return skippedResult(jobType, entityType, state, 'cooldown');
  }
  if (
    state?.status === 'running'
    && state.lastStartedAt
    && startedAt.getTime() - state.lastStartedAt.getTime() < RUN_OWNERSHIP_MS
  ) {
    return skippedResult(jobType, entityType, state, 'running');
  }

  // `lastError` is deliberately NOT cleared here.
  //
  // It used to be nulled at the start of every run, which meant a recorded
  // failure survived only until the next invocation — a shape rejection would
  // be erased by a run that did no work and could not have resolved it.
  // `last_error` is last-write-wins with no history, so it has to mean "the last
  // thing that went wrong and has not been superseded by a run that actually
  // succeeded". The completion paths below clear it on a genuinely clean run.
  await db
    .insert(contactSyncState)
    .values({ entityType, jobType, status: 'running', lastStartedAt: startedAt, updatedAt: startedAt })
    .onConflictDoUpdate({
      target: contactSyncState.entityType,
      set: { jobType, status: 'running', lastStartedAt: startedAt, updatedAt: startedAt },
    });

  try {
    const response = entityType === 'Sales Rep'
      ? await syncSalesRepRoster(jobType, entityType, now)
      : await syncPagedRun(jobType, entityType, state, now);
    await recordRun(payload, response);
    return response;
  } catch (err) {
    // No cooldown on failure. The cursor was saved after every completed page,
    // so the next scheduled run resumes at the page that failed.
    const message = err ? describeSyncError(err) : 'Unknown sync contacts failure';
    await db.update(contactSyncState)
      .set({
        status: 'failed',
        lastError: message,
        nextAllowedAt: null,
        updatedAt: new Date(now()),
      })
      .where(eq(contactSyncState.entityType, entityType));
    throw err;
  }
}

/**
 * Sales Rep comes from GetOrderMarketingRep: one request, ~48 rows, not paged.
 * It stays a single pass because the deactivate-then-reactivate guard needs the
 * whole roster in hand at once.
 */
async function syncSalesRepRoster(
  jobType: string,
  entityType: SyncContactEntityType,
  now: () => number,
): Promise<SyncContactTypeResult> {
  const fetched = await fetchSyncContactRows(entityType);
  if (fetched.error) throw new Error(`${jobType}: ${fetched.error}`);

  const rows = sortSyncContactRows(entityType, fetched.items)
    .filter((item) => getSyncContactLookupCode(entityType, item) !== null);
  const result = await syncContactRows(entityType, rows, { deactivateExistingSalesReps: true });
  assertNotSystemic(jobType, rows.length, result);

  const nextAllowedAt = new Date(now() + CONTACT_SYNC_COOLDOWN_MS);
  const response: SyncContactTypeResult = {
    ...result,
    jobType,
    status: 'completed',
    totalFetched: fetched.items.length,
    processed: rows.length,
    cursorLookupCode: null,
    nextAllowedAt: nextAllowedAt.toISOString(),
  };
  await db.update(contactSyncState)
    .set({
      status: 'completed',
      cursorLookupCode: null,
      lastSyncedAt: new Date(now()),
      lastCompletedAt: new Date(now()),
      nextAllowedAt,
      totalFetched: fetched.items.length,
      lastResult: response,
      lastError: result.errors.length > 0 ? summarizeSyncErrors(result, rows.length) : null,
      updatedAt: new Date(now()),
    })
    .where(eq(contactSyncState.entityType, entityType));
  return response;
}

async function syncPagedRun(
  jobType: string,
  entityType: Exclude<SyncContactEntityType, 'Sales Rep'>,
  state: SyncState | undefined,
  now: () => number,
): Promise<SyncContactTypeResult> {
  const deadline = createDeadline('softpro.sync_contacts_page', now);

  // A sweep with no start marker is a fresh one, whatever next_page says.
  let sweepStartedAt = state?.sweepStartedAt ?? null;
  let nextPage = sweepStartedAt ? (state?.nextPage ?? 1) : 1;
  let boundary = sweepStartedAt ? (state?.cursorLookupCode ?? null) : null;
  let totalPages = state?.totalPages ?? null;
  let sweepTotalRows = sweepStartedAt ? (state?.sweepTotalRows ?? null) : null;
  let driftSuspected = sweepStartedAt ? (state?.driftSuspected ?? false) : false;

  const totals: SyncContactsResult = { entityType, totalFetched: 0, created: 0, updated: 0, skipped: 0, errors: [], rejected: [] };
  let pagesRead = 0;
  let boundaryShifts = 0;
  let sweepCompleted = false;

  const saveCursor = async () => {
    await db.update(contactSyncState)
      .set({
        nextPage: sweepCompleted ? 1 : nextPage,
        totalPages,
        cursorLookupCode: sweepCompleted ? null : boundary,
        sweepStartedAt: sweepCompleted ? null : sweepStartedAt,
        sweepTotalRows: sweepCompleted ? null : sweepTotalRows,
        driftSuspected,
        ...(sweepCompleted
          ? { lastSweepCompletedAt: new Date(now()), lastCompletedAt: new Date(now()), lastSyncedAt: sweepStartedAt }
          : {}),
        updatedAt: new Date(now()),
      })
      .where(eq(contactSyncState.entityType, entityType));
  };

  while (pagesRead < MAX_PAGES_PER_RUN && !deadline.exceeded()) {
    const page = nextPage;
    const fetched = await fetchSyncContactPage(entityType, page);
    if (fetched.error) throw new Error(`${jobType}: page ${page}: ${fetched.error}`);

    if (page === 1) {
      sweepStartedAt = new Date(now());
      sweepTotalRows = fetched.totalRows;
      driftSuspected = false;
      boundary = null;
    }
    totalPages = fetched.totalPages ?? totalPages;

    if (fetched.items.length === 0) {
      // Empty is the end of the data only when the vendor's own count agrees.
      // During the pagination investigation Page=1 returned zero rows once and
      // 1,000 on the next call; believing a single empty page is how a sync
      // silently truncates.
      if (totalPages !== null && page <= totalPages) {
        throw new Error(`${jobType}: page ${page} of ${totalPages} came back empty`);
      }
      sweepCompleted = true;
      await saveCursor();
      break;
    }

    const rows = sortSyncContactRows(entityType, fetched.items);
    const firstCode = getSyncContactLookupCode(entityType, rows[0]!);
    const lastCode = getSyncContactLookupCode(entityType, rows[rows.length - 1]!);

    // PAGE DRIFT. Paging is offset over a sort by lookup code. An INSERTION
    // before the cursor shifts rows right: the last row of the previous page
    // reappears as this page's first — a re-read, harmless, counted here. A
    // DELETION before the cursor shifts rows left: one row moves back into a page
    // already read and is skipped until the next sweep, and no comparison of
    // codes can see it. What can be seen is TotalRows falling, so that is what
    // is recorded. The next sweep reads the row.
    if (boundary !== null && firstCode !== null && firstCode <= boundary) boundaryShifts++;
    if (sweepTotalRows !== null && fetched.totalRows !== null && fetched.totalRows < sweepTotalRows) {
      driftSuspected = true;
    }

    const result = await syncContactRows(entityType, rows);
    assertNotSystemic(jobType, rows.length, result);

    totals.totalFetched += rows.length;
    totals.created += result.created;
    totals.updated += result.updated;
    totals.skipped += result.skipped;
    totals.errors.push(...result.errors);
    totals.rejected!.push(...(result.rejected ?? []));
    pagesRead++;

    boundary = lastCode ?? boundary;
    nextPage = page + 1;
    sweepCompleted = totalPages !== null && page >= totalPages;
    await saveCursor();
    if (sweepCompleted) break;
  }

  const status = sweepCompleted ? 'completed' : 'paused';
  const response: SyncContactTypeResult = {
    ...totals,
    jobType,
    status,
    processed: totals.totalFetched,
    cursorLookupCode: sweepCompleted ? null : boundary,
    nextAllowedAt: null,
    pagesRead,
    nextPage: sweepCompleted ? 1 : nextPage,
    totalPages,
    sweepCompleted,
    driftSuspected,
    boundaryShifts,
  };

  await db.update(contactSyncState)
    .set({
      status,
      nextAllowedAt: null,
      totalFetched: totals.totalFetched,
      lastResult: response,
      // A run that failed some rows must not clear the error column on its way
      // out. Nulling it here is what made a partial failure invisible in the one
      // table that tracks this sync's health.
      lastError: totals.errors.length > 0 ? summarizeSyncErrors(totals, totals.totalFetched) : null,
      updatedAt: new Date(now()),
    })
    .where(eq(contactSyncState.entityType, entityType));

  return response;
}
