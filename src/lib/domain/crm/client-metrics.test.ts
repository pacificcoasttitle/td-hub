import { describe, expect, it } from 'vitest';
import {
  computeClientMetrics,
  computeTrend,
  isOpenOrder,
  MIN_ORDERS_FOR_TREND,
  TREND_FLAT_BAND,
  type ClientOrderRow,
} from './client-metrics';

const NOW = new Date('2026-08-03T12:00:00Z');

/** Order opened `daysAgo` before NOW. */
function order(id: number, daysAgo: number, status: string | null = 'closed'): ClientOrderRow {
  return {
    orderId: id,
    openedAt: new Date(NOW.getTime() - daysAgo * 86_400_000),
    closedAt: null,
    operationalStatus: status,
  };
}

// ─── Trend rule, pinned both directions ─────────────────────────────────────

describe('computeTrend', () => {
  it('refuses to call a direction below the minimum history', () => {
    expect(MIN_ORDERS_FOR_TREND).toBe(4);
    for (let total = 0; total < MIN_ORDERS_FOR_TREND; total++) {
      const v = computeTrend(total, 0);
      expect(v.direction).toBe('not_enough_history');
      expect(v.changePct).toBeNull();
      expect(v.confidence).toBe('none');
    }
  });

  it('calls UP when growth exceeds the flat band', () => {
    // 8 vs 4 = +100%
    const v = computeTrend(8, 4);
    expect(v.direction).toBe('up');
    expect(v.changePct).toBeCloseTo(1.0, 5);
    expect(v.confidence).toBe('high');
  });

  it('calls DOWN when decline exceeds the flat band', () => {
    // 3 vs 9 = -66.7%
    const v = computeTrend(3, 9);
    expect(v.direction).toBe('down');
    expect(v.changePct).toBeCloseTo(-2 / 3, 5);
  });

  it('calls FLAT inside the dead band, in both directions', () => {
    expect(TREND_FLAT_BAND).toBe(0.25);
    expect(computeTrend(5, 4).direction).toBe('flat');   // +25% — at the edge
    expect(computeTrend(3, 4).direction).toBe('flat');   // -25% — at the edge
    expect(computeTrend(4, 4).direction).toBe('flat');   // no change
  });

  it('treats the band as inclusive and flips just outside it', () => {
    expect(computeTrend(100, 80).direction).toBe('flat');  // exactly +25%
    expect(computeTrend(101, 80).direction).toBe('up');    // +26.25%
    expect(computeTrend(60, 80).direction).toBe('flat');   // exactly -25%
    expect(computeTrend(59, 80).direction).toBe('down');   // -26.25%
  });

  it('reports UP without a percentage when there is no prior baseline', () => {
    const v = computeTrend(5, 0);
    expect(v.direction).toBe('up');
    expect(v.changePct).toBeNull();          // never divides by zero
    expect(v.basis).toContain('none in the 90 before');
  });

  it('is deterministic — same inputs, same output', () => {
    expect(computeTrend(7, 5)).toEqual(computeTrend(7, 5));
  });
});

describe('isOpenOrder', () => {
  it('treats terminal statuses as not open', () => {
    for (const s of ['closed', 'completed', 'canceled', 'duplicate']) {
      expect(isOpenOrder(s)).toBe(false);
    }
  });
  it('treats working statuses as open', () => {
    for (const s of ['open', 'in_process', 'hold', null]) {
      expect(isOpenOrder(s)).toBe(true);
    }
  });
});

// ─── Windows and counts ─────────────────────────────────────────────────────

describe('computeClientMetrics', () => {
  it('bucket orders into the right windows', () => {
    const m = computeClientMetrics({
      clientId: 1, contactId: 10, now: NOW,
      orders: [
        order(1, 2),     // this month + last90
        order(2, 40),    // last90
        order(3, 120),   // prior90
        order(4, 150),   // prior90
        order(5, 400),   // same 90 last year (365-455 ago)
        order(6, 900),   // older than everything
      ],
    });
    expect(m.counts.last90).toBe(2);
    expect(m.counts.prior90).toBe(2);
    expect(m.counts.same90LastYear).toBe(1);
    expect(m.counts.total).toBe(6);
  });

  it('counts "this month" against the Pacific month boundary, not UTC', () => {
    // 2026-08-01T03:00Z is still 8pm on Jul 31 in California — that order
    // belongs to July, and a UTC boundary would wrongly count it in August.
    const now = new Date('2026-08-05T12:00:00Z');
    const julyInPacific = { orderId: 1, openedAt: new Date('2026-08-01T03:00:00Z'), closedAt: null, operationalStatus: 'open' };
    const augustInPacific = { orderId: 2, openedAt: new Date('2026-08-01T09:00:00Z'), closedAt: null, operationalStatus: 'open' };

    const m = computeClientMetrics({
      clientId: 1, contactId: 10, now, orders: [julyInPacific, augustInPacific],
    });
    expect(m.counts.thisMonth).toBe(1);
  });

  it('counts open orders by status, not by date, and never claims more than low confidence', () => {
    const m = computeClientMetrics({
      clientId: 1, contactId: 10, now: NOW,
      orders: [order(1, 5, 'open'), order(2, 5, 'in_process'), order(3, 5, 'hold'), order(4, 5, 'closed')],
    });
    expect(m.counts.open).toBe(3);
    // `in_process` is a catch-all files never leave, so this count can never be
    // presented as a fact about live work.
    expect(m.confidence.openOrders).toBe('low');
  });

  it('reports no open-order confidence when nothing is open', () => {
    const m = computeClientMetrics({
      clientId: 1, contactId: 10, now: NOW, orders: [order(1, 5, 'closed')],
    });
    expect(m.counts.open).toBe(0);
    expect(m.confidence.openOrders).toBe('none');
  });

  it('de-duplicates an order that matches through two paths', () => {
    // The same order can be reached via orders.client_contact_id AND
    // order_parties — it must count once.
    const dup = order(99, 10);
    const m = computeClientMetrics({
      clientId: 1, contactId: 10, now: NOW, orders: [dup, { ...dup }],
    });
    expect(m.counts.total).toBe(1);
    expect(m.counts.last90).toBe(1);
  });

  it('reports recency', () => {
    const m = computeClientMetrics({
      clientId: 1, contactId: 10, now: NOW,
      orders: [order(1, 10), order(2, 200)],
    });
    expect(m.recency.daysSinceLastOrder).toBe(10);
    expect(m.recency.firstOrderAt!.getTime()).toBe(order(2, 200).openedAt.getTime());
  });

  it('withholds an average below one month of history', () => {
    const m = computeClientMetrics({
      clientId: 1, contactId: 10, now: NOW, orders: [order(1, 5)],
    });
    expect(m.rate.avgMonthlyOrders).toBeNull();   // not faked from 5 days
  });

  it('computes an average once there is enough history', () => {
    const orders = Array.from({ length: 12 }, (_, i) => order(i + 1, (i + 1) * 30));
    const m = computeClientMetrics({ clientId: 1, contactId: 10, now: NOW, orders });
    expect(m.rate.avgMonthlyOrders).toBeGreaterThan(0);
    expect(m.rate.monthsObserved).toBeGreaterThan(11);
  });

  it('handles a client with no orders without inventing anything', () => {
    const m = computeClientMetrics({ clientId: 1, contactId: 10, now: NOW, orders: [] });
    expect(m.counts.total).toBe(0);
    expect(m.recency.lastOrderAt).toBeNull();
    expect(m.recency.daysSinceLastOrder).toBeNull();
    expect(m.rate.avgMonthlyOrders).toBeNull();
    expect(m.trend.direction).toBe('not_enough_history');
    expect(m.confidence.attribution).toBe('none');
  });

  it('marks an unlinked client and claims no identity confidence', () => {
    const m = computeClientMetrics({ clientId: 1, contactId: null, now: NOW, orders: [] });
    expect(m.unlinked).toBe(true);
    expect(m.confidence.clientIdentity).toBe('none');
  });

  it('is deterministic for a fixed `now`', () => {
    const input = { clientId: 1, contactId: 10, now: NOW, orders: [order(1, 10), order(2, 100)] };
    expect(computeClientMetrics(input)).toEqual(computeClientMetrics(input));
  });
});

// ─── Identity: the constraint that matters most ─────────────────────────────

describe('identity is never stitched', () => {
  it('gives two CRM rows for the same firm two independent snapshots', () => {
    // Mirrors the real Shalimar case from docs/referral-source-spike.md:
    // contact 8366 (66 orders) and 8365 (7 orders) are the same firm, split
    // across two ids. The engine must NOT merge them.
    const a = computeClientMetrics({
      clientId: 501, contactId: 8366, now: NOW,
      orders: [order(1, 5), order(2, 20), order(3, 60)],
    });
    const b = computeClientMetrics({
      clientId: 502, contactId: 8365, now: NOW,
      orders: [order(4, 10)],
    });

    // Each keeps its own key and its own slice — no collapsing.
    expect(a.clientId).toBe(501);
    expect(b.clientId).toBe(502);
    expect(a.contactId).toBe(8366);
    expect(b.contactId).toBe(8365);
    expect(a.counts.total).toBe(3);
    expect(b.counts.total).toBe(1);

    // Neither snapshot reflects the other's orders.
    expect(a.counts.total + b.counts.total).toBe(4);
    expect(a.recency.daysSinceLastOrder).toBe(5);
    expect(b.recency.daysSinceLastOrder).toBe(10);
  });

  it('does not reorder, rename or create — it only returns what it was given', () => {
    const m = computeClientMetrics({
      clientId: 777, contactId: 42, now: NOW, orders: [order(1, 3)],
    });
    // The output carries exactly the identity handed in.
    expect(Object.keys(m)).toContain('clientId');
    expect(m.clientId).toBe(777);
    expect(m.contactId).toBe(42);
  });
});

// ─── Reuse shape for the later reads ────────────────────────────────────────

describe('shape supports the later reads without re-querying', () => {
  const m = computeClientMetrics({
    clientId: 1, contactId: 10, now: NOW,
    orders: [order(1, 200), order(2, 210), order(3, 220), order(4, 230)],
  });

  it('gone-quiet is derivable from recency + total', () => {
    expect(m.counts.total).toBeGreaterThan(0);
    expect(m.recency.daysSinceLastOrder).toBe(200);
    // i.e. hasBusiness && daysSinceLastOrder > threshold
  });

  it('momentum is derivable from trend + counts', () => {
    expect(m.trend).toHaveProperty('direction');
    expect(m.counts).toHaveProperty('thisMonth');
    expect(m.rate).toHaveProperty('avgMonthlyOrders');
  });
});
