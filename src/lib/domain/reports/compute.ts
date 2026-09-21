/**
 * From dataset rows to the figures the three farming documents print.
 *
 * PURE, and the output is what gets STORED (metrics/months, standouts/routes,
 * cities/totals on the report rows). A re-render reads these back and costs
 * nothing — and cannot drift from what the first render printed, because it is
 * not recomputing anything.
 *
 * Every number here is one of three things: a count, a TRUE median, or a share
 * over the rows where the answer is known. Nothing is averaged except where the
 * source itself only supplies averages (the route feed), and those keep their
 * names — see definitions.ts.
 */
import {
  median, medianPricePerSqft, monthKey, shareOf, standoutBy, withinWindow,
  type AreaSaleRow, type CountySaleRow, type DateWindow, type PropertyKind, type RouteRow,
} from './datasets';

// ─── Shared ─────────────────────────────────────────────────────────────────

/** What the file gave us, printed on the page so a thin report explains itself. */
export interface DataQuality {
  rowsRead: number;
  used: number;
  rejected: number;
  /** {"Mineral Rights": 2, "(no price)": 1} */
  rejectedTypes: Record<string, number>;
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/** "August 2026", from a `2026-08` key. */
export function monthLabel(key: string): string {
  const [y, m] = key.split('-');
  return `${MONTH_NAMES[Number(m) - 1]} ${y}`;
}

// ─── 01 · Sales Activity ────────────────────────────────────────────────────

export interface SalesActivityMetrics {
  homesSold: number;
  medianPrice: number | null;
  medianPricePerSqft: number | null;
  medianBeds: number | null;
  medianBaths: number | null;
  /** Share of sales whose owner does not live there, over sales where it is KNOWN. */
  nonOccupantShare: number | null;
  /** How many sales the share is taken over — printed, so 40% of 5 reads as 5. */
  occupancyKnown: number;
  /** Rows in the file dated outside the window. Counted, not silently dropped. */
  outsideWindow: number;
}

export interface SalesActivityMonth {
  /** `2026-08` */
  key: string;
  sales: number;
  medianPrice: number | null;
  medianPricePerSqft: number | null;
  /**
   * Percent change in median $/sq ft against the PREVIOUS month in the window —
   * not year over year. Null for the oldest month, and null when either month
   * has no figure: a change from nothing is not a change.
   */
  changePct: number | null;
}

export interface SalesActivityFigures {
  metrics: SalesActivityMetrics;
  /** Every month in the window, NEWEST FIRST, including months with no sales. */
  months: SalesActivityMonth[];
}

/** Every calendar month the window spans, oldest first, as `YYYY-MM` keys. */
export function windowMonths(w: DateWindow): string[] {
  const keys: string[] = [];
  const d = new Date(Date.UTC(w.start.getUTCFullYear(), w.start.getUTCMonth(), 1));
  while (d.getTime() <= w.end.getTime()) {
    keys.push(monthKey(d));
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return keys;
}

export function computeSalesActivity(rows: readonly AreaSaleRow[], window: DateWindow): SalesActivityFigures {
  // A window is a DATE RANGE. Legacy kept any row whose month NUMBER matched,
  // so a 12-month run in September mixed three Augusts from three years.
  const inWindow = rows.filter((r) => withinWindow(r.saleDate, window));
  const known = (xs: (number | null)[]) => xs.filter((x): x is number => typeof x === 'number');

  const occupancy = inWindow.map((r) => (r.ownerOccupied === null ? null : !r.ownerOccupied));

  const metrics: SalesActivityMetrics = {
    homesSold: inWindow.length,
    medianPrice: median(inWindow.map((r) => r.price)),
    medianPricePerSqft: medianPricePerSqft(inWindow),
    medianBeds: median(known(inWindow.map((r) => r.beds))),
    medianBaths: median(known(inWindow.map((r) => r.baths))),
    nonOccupantShare: shareOf(occupancy),
    occupancyKnown: occupancy.filter((v) => v !== null).length,
    outsideWindow: rows.length - inWindow.length,
  };

  const oldestFirst = windowMonths(window).map((key) => {
    const sales = inWindow.filter((r) => monthKey(r.saleDate) === key);
    return {
      key,
      sales: sales.length,
      medianPrice: median(sales.map((r) => r.price)),
      medianPricePerSqft: medianPricePerSqft(sales),
      changePct: null as number | null,
    };
  });

  for (let i = 1; i < oldestFirst.length; i++) {
    const prev = oldestFirst[i - 1]!.medianPricePerSqft;
    const cur = oldestFirst[i]!.medianPricePerSqft;
    oldestFirst[i]!.changePct = prev && cur ? ((cur - prev) / prev) * 100 : null;
  }

  return { metrics, months: oldestFirst.reverse() };
}

// ─── 02 · Carrier Route Analysis ────────────────────────────────────────────

export const RANK_BY = ['turnover', 'non_owner', 'units', 'sales', 'price', 'years_held'] as const;
export type RankBy = typeof RANK_BY[number];

const RANK_FIELD: Record<RankBy, (r: RouteRow) => number | null> = {
  turnover: (r) => r.turnoverRate,
  non_owner: (r) => r.nonOwnerRatio,
  units: (r) => r.totalUnits,
  sales: (r) => r.totalSales,
  price: (r) => r.avgPrice,
  years_held: (r) => r.avgYearsOwned,
};

/** How the page and the list name each ranking. */
export const RANK_LABEL: Record<RankBy, string> = {
  turnover: 'turnover',
  non_owner: 'non-owner share',
  units: 'units',
  sales: 'sales',
  price: 'average price',
  years_held: 'years held',
};

export interface Standout { routeId: string; value: number }

export interface CarrierRouteFigures {
  /** The ten routes the page prints, in rank order. */
  routes: RouteRow[];
  /** How many routes the file held — so "top 10 of 38" can be said. */
  totalRoutes: number;
  /**
   * Each computed from ITS OWN FIELD over the ten shown. Legacy's non-owner
   * tile printed the turnover winner's route beside the non-owner figure.
   */
  standouts: {
    turnover: Standout | null;
    nonOwner: Standout | null;
    yearsHeld: Standout | null;
    units: Standout | null;
    sales: Standout | null;
    price: Standout | null;
  };
}

export const ROUTES_SHOWN = 10;

export function computeCarrierRoute(rows: readonly RouteRow[], rankBy: RankBy): CarrierRouteFigures {
  const field = RANK_FIELD[rankBy];
  // Highest first; a route with no figure for the ranking measure goes to the
  // bottom rather than being treated as zero. Ties break on the route id, so
  // the same file always prints the same page.
  const ranked = [...rows].sort((a, b) => {
    const va = field(a), vb = field(b);
    if (va === null && vb === null) return a.routeId.localeCompare(b.routeId);
    if (va === null) return 1;
    if (vb === null) return -1;
    return vb - va || a.routeId.localeCompare(b.routeId);
  });
  const shown = ranked.slice(0, ROUTES_SHOWN);

  const pick = (f: (r: RouteRow) => number | null): Standout | null => {
    const winner = standoutBy(shown, f);
    const value = winner ? f(winner) : null;
    return winner && value !== null ? { routeId: winner.routeId, value } : null;
  };

  return {
    routes: shown,
    totalRoutes: rows.length,
    standouts: {
      turnover: pick((r) => r.turnoverRate),
      nonOwner: pick((r) => r.nonOwnerRatio),
      yearsHeld: pick((r) => r.avgYearsOwned),
      units: pick((r) => r.totalUnits),
      sales: pick((r) => r.totalSales),
      price: pick((r) => r.avgPrice),
    },
  };
}

// ─── 03 · County Sales ──────────────────────────────────────────────────────

export interface KindFigures { sold: number; medianPrice: number | null }

export interface CountyCity {
  city: string;
  houses: KindFigures;
  condos: KindFigures;
}

export interface CountySalesFigures {
  /** Alphabetical, case-normalised. Only cities with a house or condo sale. */
  cities: CountyCity[];
  /** From the PER-SALE rows. A median of city medians is not a median. */
  totals: { houses: KindFigures; condos: KindFigures };
  /**
   * Sales the file classified that neither column holds — multi-family, land.
   * Recognised, so not rejects; not shown, so they must be SAID.
   */
  otherKinds: Partial<Record<PropertyKind, number>>;
}

function kindFigures(prices: number[]): KindFigures {
  return { sold: prices.length, medianPrice: median(prices) };
}

/**
 * The name a city prints under. `IRVINE` and `Irvine` are one city; the
 * spelling shown is the most common mixed-case one in the file, and title case
 * only when every row shouted.
 */
function displayName(variants: string[]): string {
  const counts = new Map<string, number>();
  for (const v of variants) counts.set(v, (counts.get(v) ?? 0) + 1);
  const mixed = [...counts.entries()].filter(([v]) => v !== v.toUpperCase() && v !== v.toLowerCase());
  if (mixed.length > 0) return mixed.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0];
  return variants[0]!.toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

export function computeCountySales(rows: readonly CountySaleRow[]): CountySalesFigures {
  const byCity = new Map<string, { names: string[]; houses: number[]; condos: number[] }>();
  const otherKinds: Partial<Record<PropertyKind, number>> = {};

  for (const r of rows) {
    if (r.propertyKind !== 'single_family' && r.propertyKind !== 'condominium') {
      otherKinds[r.propertyKind] = (otherKinds[r.propertyKind] ?? 0) + 1;
      continue;
    }
    const key = r.city.trim().toLowerCase();
    const entry = byCity.get(key) ?? { names: [], houses: [], condos: [] };
    entry.names.push(r.city.trim());
    (r.propertyKind === 'single_family' ? entry.houses : entry.condos).push(r.price);
    byCity.set(key, entry);
  }

  const cities = [...byCity.values()]
    .map((e) => ({ city: displayName(e.names), houses: kindFigures(e.houses), condos: kindFigures(e.condos) }))
    // Alphabetical as a reader means it: legacy's ksort put "Yorba Linda" above
    // "anaheim" because uppercase sorts first in ASCII.
    .sort((a, b) => a.city.localeCompare(b.city, 'en', { sensitivity: 'base' }));

  const all = (kind: PropertyKind) => rows.filter((r) => r.propertyKind === kind).map((r) => r.price);

  return {
    cities,
    totals: { houses: kindFigures(all('single_family')), condos: kindFigures(all('condominium')) },
    otherKinds,
  };
}

/** Cities per county page — the handoff's figure, and what fits at 8.5pt. */
export const CITIES_PER_PAGE = 22;
