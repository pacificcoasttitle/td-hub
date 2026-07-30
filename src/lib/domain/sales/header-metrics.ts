// Pure shaping for the sales dashboard header (spec:
// docs/sales-dashboard-header-redesign.md). No I/O — every function takes
// already-fetched data so it can be unit tested and so nothing here can
// fabricate a figure.

export interface TrendMonthLike {
  month: number;
  openings: number;
  closings: number;
  revenue: number;
}

export interface TrendsLike {
  currentYear: { year: number; months: TrendMonthLike[] };
  priorYear: { year: number; months: TrendMonthLike[] };
}

export interface Delta {
  /** Percent change, rounded. Negative means down. */
  pct: number;
  up: boolean;
  /** Compact chip text, e.g. "vs Jun". */
  label: string;
  /** Full basis, for title/aria — the chip alone must never imply more than it is. */
  basis: string;
}

const MONTH_ABBR = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function findMonth(months: TrendMonthLike[] | undefined, month: number): TrendMonthLike | null {
  return months?.find((m) => m.month === month) ?? null;
}

function pctChange(current: number, base: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(base) || base <= 0) return null;
  return Math.round(((current - base) / base) * 100);
}

function fmtUsd(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

/**
 * Month-over-month and year-over-year deltas for production revenue.
 *
 * IMPORTANT — what is being compared:
 * The trends feed exposes monthly totals only, so there is no way to compare
 * "this month so far" against "the same number of days last month". Comparing a
 * partial month against a complete one would read as a catastrophic decline for
 * most of every month.
 *
 * So the comparison basis is the PROJECTED full month against the prior
 * complete month — the only apples-to-apples comparison the data supports, and
 * it uses Managers Report's own projection rather than anything derived here.
 * When no projection is available the chips are omitted entirely.
 */
export function computeDeltas(
  trends: TrendsLike | null | undefined,
  projectedRevenue: number | null | undefined,
  now: Date,
): { mom: Delta | null; yoy: Delta | null } {
  const none = { mom: null, yoy: null };
  if (!trends || projectedRevenue == null || !Number.isFinite(projectedRevenue)) return none;

  const month = now.getMonth() + 1; // 1-12
  const curYear = trends.currentYear?.year ?? now.getFullYear();

  // Prior month, rolling back across the year boundary.
  const priorMonthNum = month === 1 ? 12 : month - 1;
  const priorMonth = month === 1
    ? findMonth(trends.priorYear?.months, 12)
    : findMonth(trends.currentYear?.months, priorMonthNum);

  const sameMonthLastYear = findMonth(trends.priorYear?.months, month);

  const momPct = priorMonth ? pctChange(projectedRevenue, priorMonth.revenue) : null;
  const yoyPct = sameMonthLastYear ? pctChange(projectedRevenue, sameMonthLastYear.revenue) : null;

  const priorYearLabel = String((trends.priorYear?.year ?? curYear - 1) % 100).padStart(2, '0');

  return {
    mom: momPct === null ? null : {
      pct: momPct,
      up: momPct >= 0,
      label: `vs ${MONTH_ABBR[priorMonthNum - 1]}`,
      basis: `Projected ${fmtUsd(projectedRevenue)} this month vs ${fmtUsd(priorMonth!.revenue)} in ${MONTH_ABBR[priorMonthNum - 1]}`,
    },
    yoy: yoyPct === null ? null : {
      pct: yoyPct,
      up: yoyPct >= 0,
      label: `vs ${MONTH_ABBR[month - 1]} '${priorYearLabel}`,
      basis: `Projected ${fmtUsd(projectedRevenue)} this month vs ${fmtUsd(sameMonthLastYear!.revenue)} in ${MONTH_ABBR[month - 1]} ${trends.priorYear?.year ?? ''}`.trim(),
    },
  };
}

export type TrendMetric = 'revenue' | 'openings' | 'closings';

/**
 * The trailing six months of a metric, oldest first, ending with the current
 * month. Returns null when fewer than two points are available — a sparkline
 * needs a line, and one point is not a trend.
 */
export function sixMonthSeries(
  trends: TrendsLike | null | undefined,
  metric: TrendMetric,
  now: Date,
): number[] | null {
  if (!trends) return null;

  const month = now.getMonth() + 1;
  const out: number[] = [];

  for (let back = 5; back >= 0; back--) {
    const raw = month - back;
    const inPriorYear = raw <= 0;
    const m = inPriorYear ? raw + 12 : raw;
    const source = inPriorYear ? trends.priorYear?.months : trends.currentYear?.months;
    const found = findMonth(source, m);
    if (found) out.push(found[metric] ?? 0);
  }

  return out.length >= 2 ? out : null;
}

// ─── Seven-day strip ────────────────────────────────────────────────────────

export interface ClosingEntryLike {
  closedDate: string;
  revenue: number;
}

export interface DayBucket {
  /** YYYY-MM-DD */
  date: string;
  /** Short weekday, e.g. "Thu". */
  dow: string;
  closings: number;
  revenue: number;
  /** True for the most recent day in the window (rendered as the accent). */
  isLatest: boolean;
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function toKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Parses MR's closedDate (ISO or YYYY-MM-DD) to a local Y-M-D key without timezone drift. */
export function closedDateKey(raw: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw ?? '');
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/**
 * Buckets closing entries into the trailing `days` days ending at `endDate`
 * (inclusive). Days with no closings are present with zero — an empty day is
 * information, not a gap.
 */
export function bucketDailyClosings(
  entries: ClosingEntryLike[],
  endDate: Date,
  days = 7,
): DayBucket[] {
  const byKey = new Map<string, { closings: number; revenue: number }>();
  for (const e of entries ?? []) {
    const key = closedDateKey(e.closedDate);
    if (!key) continue;
    const cur = byKey.get(key) ?? { closings: 0, revenue: 0 };
    cur.closings += 1;
    cur.revenue += Number.isFinite(e.revenue) ? e.revenue : 0;
    byKey.set(key, cur);
  }

  const out: DayBucket[] = [];
  for (let back = days - 1; back >= 0; back--) {
    const d = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate() - back);
    const key = toKey(d);
    const hit = byKey.get(key);
    out.push({
      date: key,
      dow: DOW[d.getDay()],
      closings: hit?.closings ?? 0,
      revenue: hit?.revenue ?? 0,
      isLatest: back === 0,
    });
  }
  return out;
}

/**
 * Average closings per business day elapsed this month, used for the
 * "vs daily average" comparison. Weekends are excluded because title work
 * doesn't happen on them — including them would drag the average down and make
 * every weekday look above par.
 */
export function monthDailyAverage(
  entries: ClosingEntryLike[],
  now: Date,
): number | null {
  const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const inMonth = (entries ?? []).filter((e) => closedDateKey(e.closedDate)?.startsWith(monthPrefix));
  if (inMonth.length === 0) return null;

  let businessDays = 0;
  for (let day = 1; day <= now.getDate(); day++) {
    const dow = new Date(now.getFullYear(), now.getMonth(), day).getDay();
    if (dow !== 0 && dow !== 6) businessDays++;
  }
  if (businessDays === 0) return null;

  return inMonth.length / businessDays;
}

export interface SevenDaySummary {
  days: DayBucket[];
  totalClosings: number;
  totalRevenue: number;
  bestDay: DayBucket | null;
  monthDailyAvg: number | null;
}

export function summariseSevenDays(
  entries: ClosingEntryLike[],
  now: Date,
): SevenDaySummary {
  const days = bucketDailyClosings(entries, now, 7);
  const totalClosings = days.reduce((s, d) => s + d.closings, 0);
  const totalRevenue = days.reduce((s, d) => s + d.revenue, 0);
  const withClosings = days.filter((d) => d.closings > 0);
  const bestDay = withClosings.length
    ? withClosings.reduce((best, d) => (d.closings > best.closings ? d : best))
    : null;
  return {
    days,
    totalClosings,
    totalRevenue,
    bestDay,
    monthDailyAvg: monthDailyAverage(entries, now),
  };
}
