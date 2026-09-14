import { db } from '@/lib/db/client';
import { contactSyncState, jobs } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import {
  describeSyncError,
  fetchSyncContactRows,
  getSyncContactLookupCode,
  sortSyncContactRows,
  syncContactRows,
  type SyncContactEntityType,
  type SyncContactsResult,
} from './sync-contacts';

const CONTACT_SYNC_COOLDOWN_MS = 16 * 60 * 60 * 1000;

/**
 * Rows processed per invocation.
 *
 * This job has no interruptible per-item loop at this level — it hands the
 * whole batch to syncContactRows() as one bulk operation and commits the
 * cursor once afterwards. So unlike the other long-runners it cannot be
 * protected by a deadline guard (see src/lib/jobs/time-budget.ts); the batch
 * size IS its time budget.
 *
 * At the previous 3,000 a full batch measured 237–288s against a 300s Vercel
 * ceiling — which is why softpro.sync_all_contacts accounts for all 95 of the
 * watchdog kills recorded between Apr 3 and Jul 13, while the per-type jobs
 * (which sync one smaller lookup table each) have never been killed.
 *
 * At the measured ~0.09s/row, 1,000 rows lands near 90s — comfortably inside
 * the same ~270s worst-case target the deadline-guarded jobs use.
 *
 * Throughput is unaffected: progress is cursor-based, and the per-type jobs
 * run hourly or 3-hourly, so the drain rate is 8,000–24,000 rows/day/type
 * against ~21,600 total contacts.
 */
const CONTACT_SYNC_BATCH_SIZE = 1000;

/** Ceiling this batch size is sized against; exported for the sizing test. */
export const CONTACT_SYNC_BATCH_LIMITS = {
  batchSize: CONTACT_SYNC_BATCH_SIZE,
  measuredSecondsPerRow: 0.09,
  worstCaseTargetSeconds: 270,
  functionCeilingSeconds: 300,
} as const;

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
  cursorLookupCode: string | null;
  nextAllowedAt: string | null;
}

export interface SyncContactTypePayload {
  /** Injected by the job runner so a partial failure can record itself. */
  __jobId?: number;
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

export async function handleSyncContactType(
  jobType: keyof typeof CONTACT_SYNC_JOB_CONFIGS,
  payload: SyncContactTypePayload = {},
): Promise<SyncContactTypeResult> {
  const entityType = CONTACT_SYNC_JOB_CONFIGS[jobType];
  const now = new Date();
  const [existingState] = await db
    .select()
    .from(contactSyncState)
    .where(eq(contactSyncState.entityType, entityType))
    .limit(1);

  if (existingState?.nextAllowedAt && existingState.nextAllowedAt > now) {
    return {
      jobType,
      entityType,
      status: 'skipped',
      totalFetched: existingState.totalFetched,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [],
      processed: 0,
      cursorLookupCode: existingState.cursorLookupCode,
      nextAllowedAt: existingState.nextAllowedAt.toISOString(),
    };
  }

  // `lastError` is deliberately NOT cleared here.
  //
  // It used to be nulled at the start of every run, which meant a recorded
  // failure survived only until the next invocation. That is fatal for a
  // rejection: the officer feed fetches with `modifiedSince = last_synced_at`,
  // so the run after a rejection usually returns zero rows and takes the
  // empty-batch path, which records nothing — the rejection would be erased by
  // a run that did no work and could not have resolved it. `last_error` is
  // last-write-wins with no history, so it has to mean "the last thing that
  // went wrong and has not been superseded by a run that actually succeeded".
  // The completion path below clears it on a genuinely clean run.
  await db
    .insert(contactSyncState)
    .values({
      entityType,
      jobType,
      status: 'running',
      lastStartedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: contactSyncState.entityType,
      set: {
        jobType,
        status: 'running',
        lastStartedAt: now,
        updatedAt: now,
      },
    });

  try {
    const syncStartedAt = new Date();
    const fetched = await fetchSyncContactRows(entityType, {
      modifiedSince: existingState?.lastSyncedAt?.toISOString() ?? null,
    });
    if (fetched.error) {
      throw new Error(`${jobType}: ${fetched.error}`);
    }

    const cursor = existingState?.cursorLookupCode ?? null;
    const orderedRows = sortSyncContactRows(entityType, fetched.items)
      .map((item) => ({ item, lookupCode: getSyncContactLookupCode(entityType, item) }))
      .filter((row) => row.lookupCode !== null && (!cursor || row.lookupCode > cursor));

    const batch = orderedRows.slice(0, CONTACT_SYNC_BATCH_SIZE);
    if (batch.length === 0) {
      const nextAllowedAt = new Date(Date.now() + CONTACT_SYNC_COOLDOWN_MS);
      const empty = {
        jobType,
        entityType,
        status: 'completed' as const,
        totalFetched: fetched.items.length,
        created: 0,
        updated: 0,
        skipped: 0,
        errors: [],
        processed: 0,
        cursorLookupCode: null,
        nextAllowedAt: nextAllowedAt.toISOString(),
      };

      await db.update(contactSyncState)
        .set({
          status: 'completed',
          cursorLookupCode: null,
          lastSyncedAt: now,
          lastCompletedAt: new Date(),
          nextAllowedAt,
          totalFetched: fetched.items.length,
          lastResult: empty,
          updatedAt: new Date(),
        })
        .where(eq(contactSyncState.entityType, entityType));

      return empty;
    }

    const result = await syncContactRows(
      entityType,
      batch.map((row) => row.item),
      { deactivateExistingSalesReps: entityType === 'Sales Rep' && !cursor },
    );

    const processed = batch.length;
    const lastCursor = batch[batch.length - 1]?.lookupCode ?? cursor;
    const completed = processed === orderedRows.length;
    const nextAllowedAt = completed ? new Date(Date.now() + CONTACT_SYNC_COOLDOWN_MS) : null;
    const status = completed ? 'completed' : 'paused';
    const response: SyncContactTypeResult = {
      ...result,
      jobType,
      status,
      totalFetched: fetched.items.length,
      processed,
      cursorLookupCode: completed ? null : lastCursor,
      nextAllowedAt: nextAllowedAt?.toISOString() ?? null,
    };

    // "Every row we tried to write failed" means something systemic — the
    // unique-index collision that broke four officers looked exactly like this.
    // Rows the shape guard declined were never attempted, so they are excluded
    // from both sides of the comparison. Counting them as attempts would let a
    // single permanently-malformed vendor row hold this job in `failed` forever,
    // and a rejection is an expected steady state until SoftPro fixes the feed.
    const rejectedCount = result.rejected?.length ?? 0;
    const attempted = processed - rejectedCount;
    const unexpectedFailures = result.errors.length - rejectedCount;
    if (attempted > 0 && result.created === 0 && result.updated === 0 && unexpectedFailures === attempted) {
      throw new Error(`${jobType}: ${attempted} attempts, 0 successes`);
    }

    // A row the shape guard rejected still advances `lastSyncedAt`, and that is
    // intended. The next fetch sends `modifiedSince = lastSyncedAt`, so the
    // rejected row will not come back — but it also cannot become well-formed on
    // its own, because only SoftPro can fix a column-shifted feed row. When they
    // do fix it they modify it, which moves the row's own `LastModifiedAt` (the
    // field the feed filters on) into the new window, and the row returns and is
    // retried automatically. Holding the cursor back instead would re-fetch and
    // re-reject the same row on every run forever without ever repairing it.
    await db.update(contactSyncState)
      .set({
        status,
        cursorLookupCode: completed ? null : lastCursor,
        lastSyncedAt: completed ? syncStartedAt : existingState?.lastSyncedAt ?? null,
        lastCompletedAt: completed ? new Date() : existingState?.lastCompletedAt ?? null,
        nextAllowedAt,
        totalFetched: fetched.items.length,
        lastResult: response,
        // A run that failed some rows must not clear the error column on its way
        // out. Nulling it here is what made a partial failure invisible in the
        // one table that tracks this sync's health.
        lastError: result.errors.length > 0
          ? summarizeSyncErrors(result, processed)
          : null,
        updatedAt: new Date(),
      })
      .where(eq(contactSyncState.entityType, entityType));

    await recordRun(payload, response);

    return response;
  } catch (err) {
    const message = err ? describeSyncError(err) : 'Unknown sync contacts failure';
    await db.update(contactSyncState)
      .set({
        status: 'failed',
        lastError: message,
        nextAllowedAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
        updatedAt: new Date(),
      })
      .where(eq(contactSyncState.entityType, entityType));
    throw err;
  }
}
