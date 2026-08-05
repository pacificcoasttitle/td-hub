// Gone-quiet and momentum — the two triage signals a rep reads off a list row.
//
// Both are READS on the PR #14 metrics engine (`client-metrics.ts`). Nothing
// here re-derives a metric from orders; if a number is needed it comes off
// ClientOrderMetrics or it does not exist.
//
// THEY KEY ON `opened_at` AND ORDER COUNTS ONLY — never operational_status.
// That is deliberate: ~24% of in_process rows are stale against SoftPro
// (docs/order-status-hygiene.md), so anything built on status inherits a known
// wrong number. Recency and counts rest on the clean order->client and
// order->rep links.
//
// CADENCE BASELINE, NOT A BLANKET THRESHOLD.
// The old rule was "no order in 3 months = quiet" for everyone. That is wrong in
// both directions: a client who normally orders six times a month has clearly
// gone cold after five weeks, while one who orders twice a year has not. Both
// signals below compare a client against THEIR OWN established rhythm.

import type { ClientOrderMetrics } from './client-metrics';

export type SignalKind =
  /** Prior business, now silent relative to their own cadence. */
  | 'quiet'
  /** Running hotter than their own average this month. */
  | 'momentum'
  /** 90-day volume down against the prior 90, past the engine's flat band. */
  | 'declining'
  /** Ordering at roughly their usual rate. */
  | 'steady'
  /** Not enough history to say anything. Renders as nothing, not as "fine". */
  | 'unknown';

export type SignalTone = 'success' | 'warning' | 'neutral' | 'muted';

export interface ClientSignal {
  kind: SignalKind;
  tone: SignalTone;
  /** Short chip text for a list row. */
  label: string;
  /** One line of "why", for the profile page and the row tooltip. */
  detail: string | null;
}

/**
 * Orders needed before a client has a cadence worth comparing against.
 * Below this, two orders a week apart would imply a 2/week rhythm.
 */
export const MIN_ORDERS_FOR_CADENCE = 3;

/**
 * How many of a client's own typical gaps must pass before they read as quiet.
 * Three missed cycles is a pattern; one is a slow fortnight.
 */
export const QUIET_GAP_MULTIPLE = 3;

/**
 * Floor on the quiet window regardless of cadence. Without it, a client who
 * orders twice a week would be flagged after six days, which is noise.
 */
export const QUIET_MIN_DAYS = 21;

/**
 * Ceiling on the quiet window. A client who orders twice a year has a 180-day
 * gap, and 3x that is 18 months — long past the point anyone would call it
 * anything but cold.
 */
export const QUIET_MAX_DAYS = 180;

/** This month must beat the client's own average by this much to read as momentum. */
export const MOMENTUM_MULTIPLE = 1.5;

/** …and clear this many orders, so 1-vs-0.4 does not present as a surge. */
export const MOMENTUM_MIN_ORDERS = 2;

/** The client's typical days between orders, from their own observed rate. */
export function expectedGapDays(metrics: ClientOrderMetrics): number | null {
  const rate = metrics.rate.avgMonthlyOrders;
  if (rate === null || rate <= 0) return null;
  return 30.44 / rate;
}

/**
 * The quiet threshold for THIS client: three of their own cycles, clamped so
 * the signal stays sane at both ends of the cadence range.
 */
export function quietAfterDays(metrics: ClientOrderMetrics): number | null {
  const gap = expectedGapDays(metrics);
  if (gap === null) return null;
  return Math.min(QUIET_MAX_DAYS, Math.max(QUIET_MIN_DAYS, gap * QUIET_GAP_MULTIPLE));
}

function hasCadence(metrics: ClientOrderMetrics): boolean {
  return (
    !metrics.unlinked
    && metrics.counts.total >= MIN_ORDERS_FOR_CADENCE
    && metrics.rate.avgMonthlyOrders !== null
    && metrics.recency.daysSinceLastOrder !== null
  );
}

/** Renders a rate the way a rep would say it: "~6/mo", "~0.5/mo". */
function fmtRate(rate: number): string {
  return rate >= 1 ? `~${Math.round(rate)}/mo` : `~${rate.toFixed(1)}/mo`;
}

export function isGoneQuiet(metrics: ClientOrderMetrics): boolean {
  if (!hasCadence(metrics)) return false;
  const threshold = quietAfterDays(metrics);
  if (threshold === null) return false;
  return metrics.recency.daysSinceLastOrder! >= threshold;
}

/**
 * True when this calendar month has ALREADY beaten the client's monthly
 * average. Deliberately not pro-rated: three orders on the 3rd of the month is
 * a busy Monday, not a trend, and pro-rating would scream momentum at it. The
 * cost is that this cannot fire early in a month — which `hasMomentum` covers.
 */
function beatsMonthlyAverage(metrics: ClientOrderMetrics): boolean {
  const avg = metrics.rate.avgMonthlyOrders!;
  const thisMonth = metrics.counts.thisMonth;
  return thisMonth >= MOMENTUM_MIN_ORDERS && thisMonth >= avg * MOMENTUM_MULTIPLE;
}

export function hasMomentum(metrics: ClientOrderMetrics): boolean {
  if (!hasCadence(metrics)) return false;
  // A client who has gone quiet is not gaining momentum, whatever this month's
  // partial count says.
  if (isGoneQuiet(metrics)) return false;

  // Two ways up, and the second one matters. The month-to-date test is the
  // punchier signal but is structurally blind early in a month — on the 4th, a
  // client cannot yet out-run their own monthly average. Without the 90-day
  // trend as a fallback, a client the health snapshot calls "Trending up +62%"
  // would carry a "Steady" chip on the same screen. Observed on real data.
  return beatsMonthlyAverage(metrics) || metrics.trend.direction === 'up';
}

/**
 * The single chip a row shows. Priority is deliberate: a client who has gone
 * silent matters more than a percentage, and a decline matters more than
 * "steady". Only one signal is shown so the row stays scannable.
 */
export function deriveSignal(metrics: ClientOrderMetrics): ClientSignal {
  if (!hasCadence(metrics)) {
    // Includes unlinked clients and anyone with one or two orders. Saying
    // nothing is correct here — "steady" would be a claim we cannot support.
    return {
      kind: 'unknown',
      tone: 'muted',
      label: '',
      detail: metrics.counts.total > 0
        ? 'Not enough order history yet to read a pattern.'
        : null,
    };
  }

  const avg = metrics.rate.avgMonthlyOrders!;
  const days = metrics.recency.daysSinceLastOrder!;

  if (isGoneQuiet(metrics)) {
    return {
      kind: 'quiet',
      tone: 'warning',
      label: `Quiet ${days} days`,
      detail: `Usually ${fmtRate(avg)}, nothing in ${days} days.`,
    };
  }

  if (hasMomentum(metrics)) {
    // Prefer the month-to-date framing a rep can act on ("4 this month vs ~2
    // avg"); fall back to the 90-day trend when the month is too young to have
    // out-run the average yet.
    if (beatsMonthlyAverage(metrics)) {
      const n = metrics.counts.thisMonth;
      const pct = avg > 0 ? Math.round((n / avg - 1) * 100) : null;
      return {
        kind: 'momentum',
        tone: 'success',
        label: pct !== null ? `Up ${pct}%` : 'Picking up',
        detail: `${n} this month vs ${fmtRate(avg)} average.`,
      };
    }
    const pct = metrics.trend.changePct;
    return {
      kind: 'momentum',
      tone: 'success',
      label: pct !== null ? `Up ${Math.round(pct * 100)}%` : 'Picking up',
      detail: metrics.trend.basis,
    };
  }

  if (metrics.trend.direction === 'down') {
    const pct = metrics.trend.changePct;
    return {
      kind: 'declining',
      tone: 'warning',
      label: pct !== null ? `Down ${Math.abs(Math.round(pct * 100))}%` : 'Slowing',
      detail: metrics.trend.basis,
    };
  }

  return {
    kind: 'steady',
    tone: 'neutral',
    label: 'Steady',
    detail: `${fmtRate(avg)} on average; last order ${days} days ago.`,
  };
}
