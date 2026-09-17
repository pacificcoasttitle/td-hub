/**
 * The sentences the farming documents print about their own numbers.
 *
 * They live here, in code, because both exist to stop a label drifting from the
 * maths behind it — and a definition kept only in a ticket drifts first.
 *
 * ─── WHY THE ROUTE REPORT SAYS AVERAGE ──────────────────────────────────────
 *
 * The County report's column said Median and the code computed a mean: the
 * label was right, so the maths changed. The route report is the same principle
 * pointing the other way. Its feed is pre-aggregated — `avg_price`,
 * `avg_yr_owned` — and the underlying sales are not in it, so a median is not
 * computable at all. The label comes down to the data.
 *
 * `RouteRow.avgPrice` / `avgYearsOwned` are named so nothing downstream can
 * print an average under a column saying median, and a test asserts the field
 * is not called `medianPrice`. If SiteX Farms ever delivers per-sale route
 * rows, this becomes a median — as a deliberate change, with the sentence
 * below rewritten, rather than silently.
 *
 * ─── WHY THE STANDOUTS ARE THE BEST OF THE TEN SHOWN ────────────────────────
 *
 * Computing them from the whole file sounds better and is worse: a tile could
 * name a route that is not in the table beneath it, and the agent has no way to
 * look it up. A standout that references something invisible is a dead end. So
 * the tiles are scoped to the ten printed, and the page says so — if the area
 * champion on another measure is what is wanted, sort by that measure.
 */

/** Printed under the route table. Says whose average, and from where. */
export const ROUTE_AVERAGE_NOTE =
  'Average price and average years owned are route averages supplied by the source data, not medians. '
  + 'The individual sales behind them are not included in the route feed.';

/** Printed with the six highlight tiles. */
export const ROUTE_STANDOUT_NOTE =
  'Each highlight is the best of the ten routes shown, not of the whole area. '
  + 'To find the area leader on another measure, run the report sorted by that measure.';

/** Printed under the county table, where the medians ARE computed by us. */
export const COUNTY_MEDIAN_NOTE =
  'Every price shown is a median of the individual sales in this month, not an average.';

/** Printed under the sales activity table. */
export const AREA_MEDIAN_NOTE =
  'Medians are taken across the individual sales in the window. '
  + 'Price per square foot is the median of each home\'s own rate, not total price divided by total area.';

/** The three one-line explanations the route page carries for its columns. */
export const ROUTE_COLUMN_DEFINITIONS: ReadonlyArray<{ term: string; meaning: string }> = [
  { term: 'Turnover', meaning: 'The share of homes on the route that sold in the period covered by the source data.' },
  { term: 'Non-owner', meaning: 'The share of homes on the route whose owner does not live there.' },
  { term: 'Units', meaning: 'How many addresses the route delivers to — the size of a mailing.' },
];
