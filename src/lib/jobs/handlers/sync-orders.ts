import {
  getOrders,
  getOrderContacts,
  mapSoftProOrder,
  mapOrderContacts,
  type SoftProOrderItem,
} from '@/lib/integrations/softpro';
import {
  describeSuspectedTruncation,
  isSuspectedTruncation,
  SOFTPRO_SEARCH_ROW_CAP,
} from '@/lib/integrations/softpro/vendor-limits';
import {
  upsertFromSoftPro,
  getOrderByFileNumber,
} from '@/lib/domain/orders/service';
import { applySiteXPropertyFields } from '@/lib/domain/orders/apply-sitex-property';
import { propertyLookup } from '@/lib/integrations/sitex/client';
import { createDeadline } from '@/lib/jobs/time-budget';
import {
  chunkDateRange,
  syncWindow,
  syncWindowChunks,
  SYNC_CHUNK_DAYS,
  type SyncWindowChunk,
} from '@/lib/jobs/sync-window';
import { db } from '@/lib/db/client';
import { jobs } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export interface SyncOrdersPayload {
  dateFrom?: string;
  dateTo?: string;
  __jobId?: number;
}

/** What one GetOrders call over one slice of the window returned. */
export interface SyncOrdersChunkResult {
  dateFrom: string;
  dateTo: string;
  /**
   * Rows the vendor returned, or null when the call never produced a list.
   *
   * NOT a total when `truncationSuspected` is set — see vendor-limits.
   */
  rowCount: number | null;
  /** Row count landed exactly on SoftPro's silent search cap. */
  truncationSuspected: boolean;
  /** Set when this slice of the window was not read. The day is a coverage gap. */
  error: string | null;
  /** GetOrders calls spent on this slice, including the one retry. */
  attempts: number;
}

export interface SyncOrdersResult {
  /** Distinct orders across every slice, after de-duplication. */
  totalFetched: number;
  created: number;
  updated: number;
  enriched: number;
  sitexEnriched: number;
  /** The window actually requested, so a run's coverage is auditable after the fact. */
  dateFrom: string;
  dateTo: string;
  /** True when the time budget ended the run before every fetched order was processed. */
  stoppedEarly: boolean;
  /** Every slice of the window and what it returned. A failed day is here, never absent. */
  chunks: SyncOrdersChunkResult[];
  /** Slices that were never read. Each is a day of the window this run did not cover. */
  failedChunks: number;
  /** Slices whose row count sat exactly on the vendor cap. */
  truncationSuspectedChunks: number;
  /** Convenience flag for the ops panel; true when any slice is suspect. */
  truncationSuspected: boolean;
  /** GetOrders calls this run made, retries included. */
  vendorListCalls: number;
  errors: Array<{ fileNumber: string; error: string }>;
}

/**
 * Retries per slice, beyond the first attempt.
 *
 * ONE, deliberately. A slice that fails twice in a row is very unlikely to
 * succeed on a third try inside the same run, and the window is trailing: this
 * date is requested again by the next hourly run, and by the seven after that.
 * The retry is here to absorb a single transient blip cheaply, not to turn the
 * sync into a retry engine.
 */
const CHUNK_RETRIES = 1;

/** Pause before the retry, so an instantaneous blip is not retried instantly. */
const RETRY_DELAY_MS = 1_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Sync orders from SoftPro.
 * Flow: GetOrders per day → for each NEW order → GetOrderContacts → enrich with
 * contact data. Then if address is available → SiteX property lookup → enrich
 * order_properties. Existing orders only get status + date updates (no re-fetch
 * of contacts or SiteX).
 *
 * ONE CALL PER DAY, NOT ONE CALL PER WINDOW. SoftPro's order search carries an
 * unconfigured row cap and truncates silently at it — same HTTP 200, same
 * "Success", no total and no cursor. At PCT's ~50 orders/day the trailing
 * eight-date window is roughly 350 rows, comfortably past the cap, so a single
 * wide call would drop rows on most days while reporting success. Splitting the
 * same range into per-day calls keeps every call far under the cap without
 * narrowing coverage: the chunks partition the window, so the union of the calls
 * is exactly the range one call used to ask for.
 *
 * A DAY THAT FAILS IS REPORTED, NOT SWALLOWED, AND DOES NOT ABORT THE RUN.
 * Aborting would throw away the seven days that did work, and a sync that can
 * halt itself over one vendor blip is the failure mode the trailing window was
 * introduced to end. Every slice appears in `chunks` with its own error, the
 * count is summarised in `failedChunks`, and the whole result is written back
 * onto the job's own row so the gap survives the function exiting.
 */
export async function handleSyncOrders(
  payload: SyncOrdersPayload = {}
): Promise<SyncOrdersResult> {
  // An explicit range is chunked on the same rule as the default window, so a
  // manual backfill cannot reintroduce the wide call by the back door.
  const explicitRange = payload.dateFrom !== undefined || payload.dateTo !== undefined;
  const fallback = syncWindow();
  const dateFrom = payload.dateFrom ?? fallback.dateFrom;
  const dateTo = payload.dateTo ?? fallback.dateTo;
  const chunks: SyncWindowChunk[] = explicitRange
    ? chunkDateRange(dateFrom, dateTo, SYNC_CHUNK_DAYS)
    : syncWindowChunks();

  const deadline = createDeadline('softpro.sync_recent_orders');

  const chunkResults: SyncOrdersChunkResult[] = [];
  let vendorListCalls = 0;

  // Fetch every slice BEFORE processing any of it. The list calls are cheap and
  // bounded (one per day of the window), while processing is not, so doing them
  // up front means a budget stop can only cost processing — it can never leave a
  // day of the window unrequested, which is the failure this job exists to avoid.
  const bySlice: Array<{ chunk: SyncWindowChunk; items: SoftProOrderItem[] }> = [];

  for (const chunk of chunks) {
    if (deadline.exceeded()) {
      chunkResults.push({
        ...chunk,
        rowCount: null,
        truncationSuspected: false,
        error: 'Skipped — the run\'s time budget was exhausted before this day was requested',
        attempts: 0,
      });
      continue;
    }

    const fetched = await fetchChunk(chunk);
    vendorListCalls += fetched.attempts;
    chunkResults.push(fetched.result);
    if (fetched.result.error === null && fetched.items) {
      bySlice.push({ chunk, items: fetched.items });
    }
  }

  // Newest slice first. Adjacent one-day slices do not overlap — SoftPro's
  // DateFrom/DateTo are inclusive and each date belongs to exactly one slice —
  // but an order can still surface in two of them, because the vendor's list is
  // a live query and an order edited between two calls can answer both. De-duping
  // on the vendor's own order number keeps that from costing a second round of
  // contact and SiteX lookups. First occurrence wins; the rows carry no field
  // that would make a later one preferable.
  const seen = new Set<string>();
  const items: SoftProOrderItem[] = [];
  for (let i = bySlice.length - 1; i >= 0; i--) {
    for (const item of bySlice[i]!.items) {
      const key = item.OrderNumber?.trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      items.push(item);
    }
  }

  let created = 0;
  let updated = 0;
  let enriched = 0;
  let sitexEnriched = 0;
  let stoppedEarly = false;
  const errors: Array<{ fileNumber: string; error: string }> = [];

  // The window fetches roughly eight days' worth of rows. Almost all are already
  // known and cost one lookup each, but a burst of genuinely new orders pulls
  // contacts and SiteX per order, so the run is bounded rather than risking the
  // function ceiling. Stopping early is safe: the window is trailing, so whatever
  // is left is re-requested by the next run.
  for (const item of items) {
    if (deadline.exceeded()) {
      stoppedEarly = true;
      break;
    }
    try {
      const existing = await getOrderByFileNumber(item.OrderNumber);
      const mapped = mapSoftProOrder(item);

      if (!existing) {
        const contactsResult = await getOrderContacts(item.OrderNumber);
        if (contactsResult.success && contactsResult.data) {
          const contacts = mapOrderContacts(contactsResult.data);
          mapped.titleOfficerName = contacts.titleOfficerName;
          enriched++;
        }
      }

      const result = await upsertFromSoftPro(mapped);

      if (result.created && mapped.property.address) {
        const didEnrich = await enrichWithSiteX(result.orderId, mapped.property);
        if (didEnrich) sitexEnriched++;
      }

      if (result.created) created++;
      else updated++;
    } catch (err) {
      errors.push({
        fileNumber: item.OrderNumber,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  const truncationSuspectedChunks = chunkResults.filter((c) => c.truncationSuspected).length;

  const result: SyncOrdersResult = {
    totalFetched: items.length,
    created, updated, enriched, sitexEnriched,
    dateFrom, dateTo, stoppedEarly,
    chunks: chunkResults,
    failedChunks: chunkResults.filter((c) => c.error !== null).length,
    truncationSuspectedChunks,
    truncationSuspected: truncationSuspectedChunks > 0,
    vendorListCalls,
    errors,
  };

  await recordRun(payload, result);
  return result;
}

/**
 * One slice of the window, with a single retry.
 *
 * Never throws. A slice that cannot be read comes back with an `error` set and
 * no rows, which is what makes a bad day a reported gap instead of a silent one.
 */
async function fetchChunk(chunk: SyncWindowChunk): Promise<{
  result: SyncOrdersChunkResult;
  items: SoftProOrderItem[] | null;
  attempts: number;
}> {
  let lastError = 'Failed to fetch orders from SoftPro';

  for (let attempt = 1; attempt <= CHUNK_RETRIES + 1; attempt++) {
    const adapterResult = await getOrders(chunk).catch((err: unknown) => ({
      success: false as const,
      data: null,
      error: { message: err instanceof Error ? err.message : 'getOrders threw' },
    }));

    if (adapterResult.success && adapterResult.data) {
      const rowCount = adapterResult.data.length;
      const truncationSuspected = isSuspectedTruncation(rowCount);

      if (truncationSuspected) {
        // Loud, but never fatal. The alarm's durable home is the job record and
        // the vendor log; this line is what makes it greppable in the runtime
        // logs during an incident.
        console.error('[sync-orders] SUSPECTED VENDOR TRUNCATION', {
          message: describeSuspectedTruncation({
            operation: 'GetOrders',
            dateFrom: chunk.dateFrom,
            dateTo: chunk.dateTo,
            rowCount,
          }),
          rowCap: SOFTPRO_SEARCH_ROW_CAP,
          dateFrom: chunk.dateFrom,
          dateTo: chunk.dateTo,
          rowCount,
        });
      }

      return {
        result: { ...chunk, rowCount, truncationSuspected, error: null, attempts: attempt },
        items: adapterResult.data,
        attempts: attempt,
      };
    }

    lastError = adapterResult.error?.message ?? lastError;
    if (attempt <= CHUNK_RETRIES) await sleep(RETRY_DELAY_MS);
  }

  return {
    result: {
      ...chunk,
      rowCount: null,
      truncationSuspected: false,
      error: lastError,
      attempts: CHUNK_RETRIES + 1,
    },
    items: null,
    attempts: CHUNK_RETRIES + 1,
  };
}

/**
 * Persists the run's outcome onto this job's own `jobs` row.
 *
 * Same approach the drift detector and the look-back sync already use: the
 * runner stores only the input payload, so a job whose result has to outlive the
 * function — a day that failed, a day that came back at the cap — writes it back
 * here. Touches no order data, and failure must never fail the run.
 */
async function recordRun(
  payload: SyncOrdersPayload,
  result: SyncOrdersResult,
): Promise<void> {
  const jobId = typeof payload.__jobId === 'number' ? payload.__jobId : null;
  if (jobId === null) return;
  try {
    await db
      .update(jobs)
      .set({ payload: { ...payload, __jobId: undefined, syncOrders: result } })
      .where(eq(jobs.id, jobId));
  } catch {
    /* the record is best-effort; never fail the sync over it */
  }
}

// ─── SiteX Enrichment ───────────────────────────────────────────────────────

async function enrichWithSiteX(
  orderId: number,
  property: { address: string | null; city: string | null; state: string | null }
): Promise<boolean> {
  if (!property.address) return false;

  try {
    const result = await propertyLookup({
      street: property.address,
      city: property.city ?? '',
      state: property.state ?? 'CA',
      zip: '',
    });

    if (!result.success || !result.data || result.data.matchCode !== 'S') {
      return false;
    }

    // Preserve-on-empty / never-overwrite — only fill blank parcel fields.
    const applied = await applySiteXPropertyFields(orderId, result.data);
    return applied.applied;
  } catch {
    return false;
  }
}
