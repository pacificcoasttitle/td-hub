import type { CompCandidate, CompCriteria } from './comp-filter';

// ─── Market metrics ──────────────────────────────────────────────────────────
//
// Three legacy bugs are fixed here, and each one is a separate exported
// function so it can be tested on its own rather than only through the report.
//
//   1. PRICE PER SQUARE FOOT — use SiteX's PricePerSQFT. The legacy report
//      printed BuildingArea in that column, so a "price per sq ft" of 1,850
//      was actually the floor area.
//
//   2. SEARCH RADIUS — the radius is what we ASKED FOR. Legacy added the
//      minimum and maximum comp proximity together and printed the sum, which
//      is not a radius, not a diameter, and not any real quantity.
//
//   3. MEDIAN — a real median. Legacy took the middle element by index, which
//      is wrong for an even-sized set and silently off-by-one for odd ones.
//
// Everything here operates on the SELECTED comps only. The legacy report mixed
// scopes — selection for the table, everything-returned for the charts — so the
// same page disagreed with itself.

/** A real median, averaging the two middle values on an even-sized set. */
export function median(values: number[]): number | null {
  const xs = values.filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 === 1 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

/**
 * Price per square foot, taken from SiteX rather than derived.
 *
 * Returns null when SiteX did not supply it — the report renders the gap. We do
 * NOT fall back to salePrice/buildingArea: a derived figure sitting in a column
 * labelled as vendor data is how the legacy bug hid for so long.
 */
export function pricePerSqft(comp: Pick<CompCandidate, 'pricePerSqft'>): number | null {
  const v = comp.pricePerSqft;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * The search radius the report prints: the one we applied.
 *
 * Not derived from the comps that came back. If the criterion was 1 mile, the
 * report says 1 mile, even when the furthest selected comp is 0.45.
 */
export function appliedRadiusMiles(criteria: CompCriteria): number | null {
  return criteria.radiusMiles;
}

export interface MarketMetrics {
  /** Count the metrics were computed from — always the SELECTED set. */
  basedOnComps: number;
  medianSalePrice: number | null;
  medianPricePerSqft: number | null;
  medianBuildingArea: number | null;
  medianYearBuilt: number | null;
  priceRangeMin: number | null;
  priceRangeMax: number | null;
  /** Furthest selected comp — reported as an observation, never as the radius. */
  furthestSelectedMiles: number | null;
  /** What we asked for. This is what the criteria block prints. */
  appliedRadiusMiles: number | null;
  /** How many selected comps lacked a vendor price-per-sqft. */
  compsMissingPricePerSqft: number;
}

export function computeMetrics(selected: CompCandidate[], criteria: CompCriteria): MarketMetrics {
  const prices = selected.map((c) => c.salePrice).filter((v): v is number => typeof v === 'number' && v > 0);
  const ppsf = selected.map(pricePerSqft).filter((v): v is number => v !== null);
  const areas = selected.map((c) => c.buildingArea).filter((v): v is number => typeof v === 'number' && v > 0);
  const years = selected.map((c) => c.yearBuilt).filter((v): v is number => typeof v === 'number' && v > 0);
  const prox = selected.map((c) => c.proximityMiles).filter((v): v is number => typeof v === 'number' && v >= 0);

  return {
    basedOnComps: selected.length,
    medianSalePrice: median(prices),
    medianPricePerSqft: median(ppsf),
    medianBuildingArea: median(areas),
    medianYearBuilt: years.length ? Math.round(median(years)!) : null,
    priceRangeMin: prices.length ? Math.min(...prices) : null,
    priceRangeMax: prices.length ? Math.max(...prices) : null,
    furthestSelectedMiles: prox.length ? Math.max(...prox) : null,
    appliedRadiusMiles: appliedRadiusMiles(criteria),
    compsMissingPricePerSqft: selected.length - ppsf.length,
  };
}
