// The trailing window the SoftPro order sync covers, and the date format the
// vendor expects.
//
// Deliberately its own module with NO imports. The sync handler and the ingest
// gap detector must agree on this window exactly — widen one and the other has
// to follow, or the detector starts policing a range the sync never fetched. But
// having the detector import the sync handler drags the whole orders service
// into anything that touches it, which breaks tests that mock the db schema.

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
 * timezone: every date is requested by ~7 consecutive runs at different UTC
 * offsets, so a late entry is picked up by a later run. Upserts are idempotent,
 * so re-requesting a date costs one DB lookup per already-known order.
 */
export const SYNC_LOOKBACK_DAYS = 7;

const DAY_MS = 86_400_000;

/** SoftPro expects MM-DD-YYYY. */
export function formatDateForSoftPro(d: Date): string {
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${month}-${day}-${d.getFullYear()}`;
}

/** The trailing window, as the vendor's date strings. */
export function syncWindow(now: Date = new Date()): { dateFrom: string; dateTo: string } {
  return {
    dateFrom: formatDateForSoftPro(new Date(now.getTime() - SYNC_LOOKBACK_DAYS * DAY_MS)),
    dateTo: formatDateForSoftPro(now),
  };
}
