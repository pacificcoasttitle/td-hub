// The trailing window the SoftPro order sync covers, how that window is split
// into vendor calls, and the date format the vendor expects.
//
// Deliberately kept free of application imports. The sync handler and the
// ingest gap detector must agree on this window exactly — widen one and the
// other has to follow, or the detector starts policing a range the sync never
// fetched. Having the detector import the sync handler drags the whole orders
// service into anything that touches it, which breaks tests that mock the db
// schema. The one import is the vendor's row cap, itself a leaf module of bare
// constants, because the chunk size is derived from that cap and hiding the
// relationship would defeat the point.

import { SOFTPRO_SEARCH_ROW_CAP } from '@/lib/integrations/softpro/vendor-limits';

/**
 * How far back each sync run reaches.
 *
 * The sync used to request today-only, and that silently dropped orders every
 * single day. The date is derived from the SERVER's calendar date, which on
 * Vercel is UTC, while SoftPro dates orders on Pacific business time. From
 * 00:00 UTC (17:00 Pacific) onward, every run asks for the *next* date — so the
 * last hours of each Pacific business day were never requested by any run, ever.
 * Not sporadically: the final run to ask for date D happened at 23:00 UTC on D,
 * and anything entered after that fell off the end permanently.
 *
 * The measured result was 221 orders missing across 29 consecutive business days
 * (2026-07-16 to 2026-08-27), affecting 28 sales reps. On 2026-08-06 alone, the
 * orders that survived had an average open hour of 0.6 while the 34 that were
 * lost averaged 20.7 — a clean time-of-day guillotine.
 *
 * A trailing window fixes this without the two systems having to agree on a
 * timezone: every date is requested by several consecutive runs at different UTC
 * offsets, so a late entry is picked up by a later run. Upserts are idempotent,
 * so re-requesting a date costs one DB lookup per already-known order.
 */
export const SYNC_LOOKBACK_DAYS = 7;

/**
 * Calendar dates the window spans. SoftPro's DateFrom/DateTo are INCLUSIVE of
 * both endpoints, so reaching back seven days covers eight dates, not seven.
 * Derived rather than written down so the chunking cannot drift from the window.
 */
export const SYNC_WINDOW_DAYS = SYNC_LOOKBACK_DAYS + 1;

/**
 * Highest single-day order volume measured in production, and the assumption
 * the chunk size below rests on.
 *
 * Measured 2026-08-27 over the trailing 21 days of `orders.opened_at` in Pacific
 * time: median ~50/day, busiest day 85. RE-MEASURE THIS BEFORE TRUSTING THE
 * CHUNK SIZE — if PCT's volume grows, the arithmetic below is what decides
 * whether a chunk still fits under the vendor's cap:
 *
 *   select (opened_at at time zone 'America/Los_Angeles')::date as day,
 *          count(*)
 *   from orders
 *   where opened_at >= now() - interval '90 days'
 *   group by 1 order by 2 desc limit 10;
 */
export const PEAK_ORDERS_PER_DAY = 85;

/**
 * How much of the cap one chunk is allowed to consume, as a divisor. At 2, a
 * chunk is sized so the busiest day we have ever seen could double before it
 * reached the cap.
 *
 * Headroom rather than an exact fit because the cap truncates silently: there is
 * no error to react to, so the margin has to be built in up front rather than
 * discovered afterwards.
 */
export const CHUNK_CAP_HEADROOM = 2;

/**
 * Longest chunk that stays under the vendor's row cap at the measured volume.
 *
 * This is the whole point of chunking, written as arithmetic rather than as a
 * literal: at 85 orders/day with 2x headroom, 250 / 170 floors to a single day.
 * If volume tripled, the same expression would still floor to 1 — a day is the
 * finest slice the vendor's date filter offers, so there is a volume beyond
 * which chunking alone cannot keep us under the cap. That is precisely what the
 * runtime alarm exists to catch: any chunk that comes back sitting exactly on
 * the cap says this assumption has been overtaken, without anyone having to
 * remember to re-run the query above.
 */
export function maxChunkDaysUnderCap(
  rowCap: number = SOFTPRO_SEARCH_ROW_CAP,
  peakOrdersPerDay: number = PEAK_ORDERS_PER_DAY,
  headroom: number = CHUNK_CAP_HEADROOM,
): number {
  return Math.max(1, Math.floor(rowCap / (peakOrdersPerDay * headroom)));
}

/** Days per vendor call. Derived from the cap; see maxChunkDaysUnderCap. */
export const SYNC_CHUNK_DAYS = maxChunkDaysUnderCap();

/** Vendor calls one sync run makes. Derived from the window and the chunk. */
export const SYNC_CHUNK_COUNT = Math.ceil(SYNC_WINDOW_DAYS / SYNC_CHUNK_DAYS);

/** One vendor call's worth of the window, as the vendor's date strings. */
export interface SyncWindowChunk {
  dateFrom: string;
  dateTo: string;
}

/** SoftPro expects MM-DD-YYYY. */
export function formatDateForSoftPro(d: Date): string {
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${month}-${day}-${d.getFullYear()}`;
}

/**
 * Calendar-day arithmetic, not millisecond arithmetic.
 *
 * Adding 86_400_000ms across a daylight-saving boundary lands on the same local
 * date twice or skips one outright, and a skipped date in a chunk list is a day
 * nobody ever asks the vendor for — the exact failure this whole window exists
 * to close. The Date constructor normalises an out-of-range day-of-month, so
 * this steps whole local days regardless of what the clock did.
 */
function addDays(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}

function parseSoftProDate(value: string): Date | null {
  const parts = value.split('-').map(Number);
  const [month, day, year] = parts;
  if (!month || !day || !year || parts.length !== 3) return null;
  const d = new Date(year, month - 1, day);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Splits an inclusive MM-DD-YYYY range into consecutive chunks of at most
 * `chunkDays`, covering every date exactly once.
 *
 * The chunks partition the range: no date appears twice and none is skipped, so
 * the union of the calls is the range the caller asked for. That is the property
 * that makes this a safe substitute for one wide call rather than a narrowing of
 * coverage.
 *
 * An unparseable range yields a single chunk of the original strings, so a
 * caller passing something we do not understand still reaches the vendor and
 * gets the vendor's own answer rather than silently fetching nothing.
 */
export function chunkDateRange(
  dateFrom: string,
  dateTo: string,
  chunkDays: number = SYNC_CHUNK_DAYS,
): SyncWindowChunk[] {
  const from = parseSoftProDate(dateFrom);
  const to = parseSoftProDate(dateTo);
  if (!from || !to || from > to) return [{ dateFrom, dateTo }];

  const step = Math.max(1, Math.floor(chunkDays));
  const chunks: SyncWindowChunk[] = [];

  for (let cursor = from; cursor <= to; cursor = addDays(cursor, step)) {
    const last = addDays(cursor, step - 1);
    chunks.push({
      dateFrom: formatDateForSoftPro(cursor),
      dateTo: formatDateForSoftPro(last > to ? to : last),
    });
  }

  return chunks;
}

/**
 * The trailing window as the sequence of calls that covers it.
 *
 * Ordered oldest first. Callers that care about the newest dates most should say
 * so explicitly rather than relying on this order.
 */
export function syncWindowChunks(now: Date = new Date()): SyncWindowChunk[] {
  const newest = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const oldest = addDays(newest, -SYNC_LOOKBACK_DAYS);
  return chunkDateRange(
    formatDateForSoftPro(oldest),
    formatDateForSoftPro(newest),
    SYNC_CHUNK_DAYS,
  );
}

/**
 * The trailing window as a single range.
 *
 * Derived from the chunks so the two can never disagree about what the window
 * is. This is the range the run COVERS; it is no longer the range of any single
 * vendor call, because one call over eight days is past SoftPro's silent row cap.
 */
export function syncWindow(now: Date = new Date()): { dateFrom: string; dateTo: string } {
  const chunks = syncWindowChunks(now);
  return {
    dateFrom: chunks[0]!.dateFrom,
    dateTo: chunks[chunks.length - 1]!.dateTo,
  };
}
