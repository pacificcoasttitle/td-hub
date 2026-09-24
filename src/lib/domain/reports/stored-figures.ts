import type {
  CarrierRouteFigures, CountySalesFigures, SalesActivityFigures,
} from './compute';

/**
 * ─── Reading figures back out of jsonb, without a blind cast ────────────────
 *
 * The farming figures are computed once and stored as jsonb. The re-render
 * reads them back and renders them, and it used to do that with `as never` —
 * a cast that tells the compiler to stop asking. That is the same mechanism
 * that hid the Concierge comp mapping losing five fields: nothing checks, so a
 * missing value arrives as `undefined` and prints as a blank.
 *
 * The template-version check upstream is the real guard — it refuses a row
 * whose figures were computed for a different document. This is the second
 * line: a row that passes that check can still hold figures that are null, or
 * an empty object written by a bug, and the difference between a blank page
 * and a stated refusal is whether anybody finds out.
 *
 * SHALLOW ON PURPOSE. This asserts the shape the document iterates — the
 * arrays and the objects it reaches into — not every leaf. A full schema here
 * would be a second copy of the figure types to keep in step, and the thing
 * worth catching is "the object is not what we think", which the top level
 * settles.
 */

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export type FiguresResult<T> = { ok: true; figures: T } | { ok: false; missing: string };

/** Sales Activity: metrics object, months array. */
export function salesActivityFigures(metrics: unknown, months: unknown): FiguresResult<SalesActivityFigures> {
  if (!isObject(metrics)) return { ok: false, missing: 'metrics' };
  if (!Array.isArray(months)) return { ok: false, missing: 'months' };
  return { ok: true, figures: { metrics, months } as unknown as SalesActivityFigures };
}

/** Carrier Route: routes array, standouts object. `totalRoutes` is passed separately. */
export function carrierRouteFigures(routes: unknown, standouts: unknown, totalRoutes: number): FiguresResult<CarrierRouteFigures> {
  if (!Array.isArray(routes)) return { ok: false, missing: 'routes' };
  if (!isObject(standouts)) return { ok: false, missing: 'standouts' };
  return { ok: true, figures: { routes, standouts, totalRoutes } as unknown as CarrierRouteFigures };
}

/**
 * County Sales: cities array, and totals holding BOTH kind objects.
 *
 * `otherKinds` is allowed to be absent — a county month where every sale was a
 * house or a condominium legitimately has none, and the document prints
 * nothing for it. Missing and empty mean the same thing there, which is not
 * true of the two above.
 */
export function countySalesFigures(cities: unknown, totals: unknown): FiguresResult<CountySalesFigures> {
  if (!Array.isArray(cities)) return { ok: false, missing: 'cities' };
  if (!isObject(totals)) return { ok: false, missing: 'totals' };
  if (!isObject(totals.houses)) return { ok: false, missing: 'totals.houses' };
  if (!isObject(totals.condos)) return { ok: false, missing: 'totals.condos' };
  const otherKinds = isObject(totals.otherKinds) ? totals.otherKinds : {};
  return {
    ok: true,
    figures: { cities, totals: { houses: totals.houses, condos: totals.condos }, otherKinds } as unknown as CountySalesFigures,
  };
}
