// Limits SoftPro's API imposes on list responses, and the only signal we get
// for them.
//
// Deliberately a LEAF MODULE with no imports, so the job layer can depend on
// the vendor's cap without dragging the SoftPro client — and through it the db
// client and schema — into anything that needs the number.
//
// THE CAP IS SILENT. SoftPro's API team confirmed the order search behind
// GetOrders shares an unconfigured row cap and truncates without saying so: the
// response still carries Status 200 and "Success", and there is no total, no
// hasMore, and no page cursor anywhere in the body. A caller that reads
// `data.length` as "how many orders exist in this range" is reading a number
// the vendor never promised.
//
// So a row count landing exactly on the cap is the only evidence we will ever
// get, and it is evidence of SUSPICION rather than of loss: a range that
// genuinely holds exactly this many orders returns exactly this many rows, and
// from outside the two are indistinguishable. Everything built on this must say
// "suspected" and must never present the count as a total.

/**
 * The vendor-side row cap on GetOrders, reported by SoftPro's API team on
 * 2026-08-27. Not configurable by us, and not echoed in the response.
 *
 * IF SOFTPRO RAISES THE CAP, CHANGE THIS NUMBER. Detection is defined as
 * "row count equals the cap", so a stale value here does not weaken the alarm,
 * it silences it completely — 250 would stop being interesting and 500 would
 * never be looked at.
 */
export const SOFTPRO_SEARCH_ROW_CAP = 250;

/**
 * True when a list response sits exactly on the cap and must therefore be
 * treated as possibly truncated.
 *
 * Deliberately EQUALITY rather than `>=`. The vendor cannot return more rows
 * than its own cap, so a larger count would mean the cap has moved and the
 * constant above is wrong — a condition `>=` quietly absorbs and equality
 * leaves visible as a silent alarm someone eventually has to explain.
 */
export function isSuspectedTruncation(rowCount: number): boolean {
  return rowCount === SOFTPRO_SEARCH_ROW_CAP;
}

/**
 * The one place the operator-facing wording lives, so the runtime log, the job
 * record, and the Operations page all say the same thing.
 *
 * The wording is load-bearing. Someone reads this while deciding whether to act,
 * and asserting "rows were lost" when the range may legitimately hold exactly
 * the cap would burn the alarm's credibility the first time it cried wolf. It
 * states what is certain (the count is at the cap, so it is unreliable) and
 * what is not (whether anything was actually dropped).
 */
export function describeSuspectedTruncation(params: {
  operation: string;
  dateFrom: string;
  dateTo: string;
  rowCount: number;
}): string {
  const range = params.dateFrom === params.dateTo
    ? params.dateFrom
    : `${params.dateFrom} to ${params.dateTo}`;
  return (
    `SoftPro ${params.operation} returned exactly ${params.rowCount} rows for ${range}, `
    + `which is the vendor's silent search cap (${SOFTPRO_SEARCH_ROW_CAP}). `
    + 'Treat that count as unreliable, not as a total: the range may hold exactly '
    + 'that many orders, or more that were dropped without any indication in the '
    + 'response. Narrow the requested range and compare before concluding anything.'
  );
}
