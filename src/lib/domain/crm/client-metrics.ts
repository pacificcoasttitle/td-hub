// Per-client order metrics — the shared spine for CRM client insights.
//
// Deterministic: same inputs produce the same output. No AI, no sampling, no
// randomness, no clock reads inside the pure layer (the caller passes `now`).
//
// SCOPE (v1):
//   - counts, recency and trend only
//   - NO revenue, NO closing-rate, NO outcome metrics. The attribution spike
//     (docs/referral-source-spike.md) found order->client and order->rep links
//     are clean (95.4% attributed to an active rep), while revenue is our
//     weakest data. Counts and recency rest on the green links; revenue waits
//     for the unified metric rather than getting a client-level definition
//     invented here.
//
// IDENTITY (load-bearing):
//   This module never dedups, merges, normalises, hides, reorders or creates a
//   client. It keys off exactly what the My Clients list keys off — a single
//   crm_clients row and its own linked contact. If the same firm exists twice
//   in a rep's list, each row gets its own independent snapshot from its own
//   slice of orders. Stitching them is explicitly out of scope and would be a
//   silent identity decision.

import { pacificMidnightUtc, pacificYmd } from '@/lib/domain/ops/calendar-day';

/** One order as the engine needs it. Deliberately minimal. */
export interface ClientOrderRow {
  orderId: number;
  /**
   * Null when SoftPro has given us no open date.
   *
   * Such a row is counted in `total` and in `open` — we know the order exists
   * and we know its status — but it takes no part in any window count or in
   * recency. Treating an unknown date as "now" would advance lastOrderAt and
   * make a client that has not ordered in a year read as active, which is the
   * exact opposite of the truth and worse than saying nothing.
   */
  openedAt: Date | null;
  closedAt: Date | null;
  /** Terminal states are not "open". */
  operationalStatus: string | null;
}

export type TrendDirection = 'up' | 'flat' | 'down' | 'not_enough_history';

/**
 * Confidence in a derived value, from what the spike measured.
 * - `high`   — rests on order->client + order->rep attribution (95.4% clean)
 * - `low`    — computed, but from too little history to lean on
 * - `none`   — not computable; the value is null and must not be rendered as a fact
 */
export type Confidence = 'high' | 'low' | 'none';

export interface TrendVerdict {
  direction: TrendDirection;
  /** Percent change of last-90 vs prior-90. Null when not judgeable. */
  changePct: number | null;
  /** Human-readable basis, so the UI never has to restate the rule. */
  basis: string;
  confidence: Confidence;
}

export interface ClientOrderMetrics {
  /** The CRM's own row id. Snapshots are per-row, never merged across rows. */
  clientId: number;
  /** Linked synced contact, or null when the client is unlinked. */
  contactId: number | null;
  /** Caller-supplied evaluation time — makes every window reproducible. */
  computedAt: Date;

  /** True when there is no linked contact, so no order history is knowable. */
  unlinked: boolean;

  counts: {
    thisMonth: number;
    last90: number;
    prior90: number;
    same90LastYear: number;
    open: number;
    total: number;
  };

  recency: {
    lastOrderAt: Date | null;
    daysSinceLastOrder: number | null;
    firstOrderAt: Date | null;
  };

  rate: {
    /** Orders per month across observed history. Null below one full month. */
    avgMonthlyOrders: number | null;
    monthsObserved: number;
  };

  trend: TrendVerdict;

  confidence: {
    /** Order->client and order->rep links. */
    attribution: Confidence;
    /** Whether this client resolves to a contact at all. */
    clientIdentity: Confidence;
    /** Whether there is enough history to read a trend. */
    trend: Confidence;
    /** Always 'low' when non-zero — see TERMINAL_STATUSES. */
    openOrders: Confidence;
  };
}

// ─── Trend rule (explicit and pinned by tests) ──────────────────────────────

/**
 * Combined orders across both 90-day windows required before a direction is
 * claimed. Below this the engine says "not enough history" rather than
 * inventing a direction from one or two orders.
 */
export const MIN_ORDERS_FOR_TREND = 4;

/**
 * Dead band. A change within ±25% reads as flat, so ordinary fluctuation
 * (3 orders vs 4) does not present as a trend.
 */
export const TREND_FLAT_BAND = 0.25;

/**
 * Terminal statuses, from the `operational_status` enum
 * (open, in_process, completed, closed, canceled, duplicate, hold).
 *
 * "Open" here means not-terminal, so `hold` counts as open — a file on hold is
 * still live work for the rep.
 *
 * KNOWN WEAKNESS — this is why `confidence.openOrders` is 'low'.
 * `in_process` is a catch-all that files fall into and never leave: it is 4,010
 * of 6,612 orders org-wide (61%), and the oldest `in_process` file for our
 * busiest CRM client dates to March 2025. So a non-terminal count is really
 * "files that never reached a terminal status", not "live work right now".
 * The UI labels it that way rather than implying currency. Fixing the
 * underlying status hygiene is a SoftPro-sync question, not a CRM one.
 */
const TERMINAL_STATUSES = new Set(['closed', 'completed', 'canceled', 'duplicate']);

export function isOpenOrder(status: string | null): boolean {
  if (!status) return true;
  return !TERMINAL_STATUSES.has(status);
}

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}

/**
 * First instant of the current month in Pacific time.
 *
 * The 90-day windows are rolling and timezone-insensitive, but "this month" is
 * a calendar claim — and everyone reading it is in California. On UTC servers a
 * naive boundary would flip the month at 5pm Pacific on the last day. Reuses
 * the ops report's DST-correct helper; still a pure function of `now`.
 */
function startOfMonth(d: Date): Date {
  const { year, month } = pacificYmd(d);
  return pacificMidnightUtc({ year, month, day: 1 });
}

function inWindow(d: Date, start: Date, end: Date): boolean {
  return d >= start && d < end;
}

export function computeTrend(last90: number, prior90: number): TrendVerdict {
  const total = last90 + prior90;

  if (total < MIN_ORDERS_FOR_TREND) {
    return {
      direction: 'not_enough_history',
      changePct: null,
      basis: `only ${total} order${total === 1 ? '' : 's'} in the last 180 days — not enough to read a trend`,
      confidence: 'none',
    };
  }

  // No prior baseline to divide by: report direction without a percentage
  // rather than dividing by zero or implying an infinite increase.
  if (prior90 === 0) {
    return {
      direction: 'up',
      changePct: null,
      basis: `${last90} orders in the last 90 days, none in the 90 before`,
      confidence: 'high',
    };
  }

  const changePct = (last90 - prior90) / prior90;
  const direction: TrendDirection = Math.abs(changePct) <= TREND_FLAT_BAND
    ? 'flat'
    : changePct > 0 ? 'up' : 'down';

  return {
    direction,
    changePct,
    basis: `${last90} orders in the last 90 days vs ${prior90} in the 90 before`,
    confidence: 'high',
  };
}

// ─── The engine ─────────────────────────────────────────────────────────────

export interface ComputeInput {
  clientId: number;
  contactId: number | null;
  /** This client's own orders. Empty is valid and yields a zeroed snapshot. */
  orders: ClientOrderRow[];
  now: Date;
}

/**
 * Computes one client's snapshot from that client's own orders.
 *
 * Pure — no I/O, no clock read. Callers hand in the rows they already scoped,
 * which is what keeps this reusable: gone-quiet reads `recency`, momentum reads
 * `trend` + `counts`, and neither needs its own query.
 */
export function computeClientMetrics(input: ComputeInput): ClientOrderMetrics {
  const { clientId, contactId, orders, now } = input;
  const unlinked = contactId === null;

  // De-duplicate by order id: an order can match a client both through
  // orders.client_contact_id and through order_parties, and must count once.
  const byId = new Map<number, ClientOrderRow>();
  for (const o of orders) byId.set(o.orderId, o);
  const rows = [...byId.values()];

  const monthStart = startOfMonth(now);
  const last90Start = addDays(now, -90);
  const prior90Start = addDays(now, -180);
  const lastYearEnd = addDays(now, -365);
  const lastYearStart = addDays(now, -455); // same 90-day span, one year earlier

  let thisMonth = 0, last90 = 0, prior90 = 0, same90LastYear = 0, open = 0;
  let lastOrderAt: Date | null = null;
  let firstOrderAt: Date | null = null;

  for (const o of rows) {
    // Status is known even when the date is not, so this counts either way.
    if (isOpenOrder(o.operationalStatus)) open++;

    const opened = o.openedAt;
    if (!opened) continue;

    if (inWindow(opened, monthStart, addDays(now, 1))) thisMonth++;
    if (inWindow(opened, last90Start, now)) last90++;
    if (inWindow(opened, prior90Start, last90Start)) prior90++;
    if (inWindow(opened, lastYearStart, lastYearEnd)) same90LastYear++;
    if (!lastOrderAt || opened > lastOrderAt) lastOrderAt = opened;
    if (!firstOrderAt || opened < firstOrderAt) firstOrderAt = opened;
  }

  const monthsObserved = firstOrderAt
    ? Math.max(0, daysBetween(firstOrderAt, now) / 30.44)
    : 0;

  const trend = computeTrend(last90, prior90);

  return {
    clientId,
    contactId,
    computedAt: now,
    unlinked,
    counts: { thisMonth, last90, prior90, same90LastYear, open, total: rows.length },
    recency: {
      lastOrderAt,
      daysSinceLastOrder: lastOrderAt ? daysBetween(lastOrderAt, now) : null,
      firstOrderAt,
    },
    rate: {
      avgMonthlyOrders: monthsObserved >= 1 ? rows.length / monthsObserved : null,
      monthsObserved,
    },
    trend,
    confidence: {
      // Measured in docs/referral-source-spike.md: 95.4% of orders carry an
      // active sales rep, 0 dangling FKs.
      attribution: rows.length > 0 ? 'high' : 'none',
      clientIdentity: unlinked ? 'none' : 'high',
      trend: trend.confidence,
      // Never better than 'low': status hygiene, not attribution, is the limit.
      openOrders: open > 0 ? 'low' : 'none',
    },
  };
}
