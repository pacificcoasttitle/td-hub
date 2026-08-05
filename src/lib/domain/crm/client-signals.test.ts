import { describe, expect, it } from 'vitest';
import { computeClientMetrics, type ClientOrderRow } from './client-metrics';
import {
  deriveSignal,
  expectedGapDays,
  hasMomentum,
  isGoneQuiet,
  MIN_ORDERS_FOR_CADENCE,
  QUIET_GAP_MULTIPLE,
  QUIET_MAX_DAYS,
  QUIET_MIN_DAYS,
  quietAfterDays,
} from './client-signals';

const NOW = new Date('2026-08-03T12:00:00Z');

/** An order opened `daysAgo` before NOW. Status is deliberately varied. */
function order(id: number, daysAgo: number, status: string | null = 'closed'): ClientOrderRow {
  return {
    orderId: id,
    openedAt: new Date(NOW.getTime() - daysAgo * 86_400_000),
    closedAt: null,
    operationalStatus: status,
  };
}

function metricsFor(orders: ClientOrderRow[], contactId: number | null = 10) {
  return computeClientMetrics({ clientId: 1, contactId, orders, now: NOW });
}

/** A steady ~6/month client over 12 months, last order `lastGap` days ago. */
function sixPerMonth(lastGap: number): ClientOrderRow[] {
  const rows: ClientOrderRow[] = [];
  for (let i = 0; i < 72; i++) rows.push(order(i + 1, lastGap + i * 5));
  return rows;
}

// ─── The constraint that matters: never touch operational_status ────────────

describe('signals key on opened_at and counts, never operational_status', () => {
  it('gives an identical verdict however the orders are statused', () => {
    const gaps = sixPerMonth(41);
    const allOpen = metricsFor(gaps.map((o) => ({ ...o, operationalStatus: 'in_process' })));
    const allClosed = metricsFor(gaps.map((o) => ({ ...o, operationalStatus: 'closed' })));
    const allNull = metricsFor(gaps.map((o) => ({ ...o, operationalStatus: null })));

    // ~24% of in_process rows are stale against SoftPro. If status leaked into
    // these signals, these three would disagree.
    expect(deriveSignal(allOpen)).toEqual(deriveSignal(allClosed));
    expect(deriveSignal(allClosed)).toEqual(deriveSignal(allNull));
    expect(deriveSignal(allOpen).kind).toBe('quiet');
  });

  it('a client whose every order is stale-open still reads as quiet', () => {
    const m = metricsFor(sixPerMonth(60).map((o) => ({ ...o, operationalStatus: 'in_process' })));
    expect(isGoneQuiet(m)).toBe(true);
  });
});

// ─── Cadence baseline, not a blanket threshold ──────────────────────────────

describe('the quiet threshold is the client’s own cadence', () => {
  it('derives the typical gap from their own rate', () => {
    const m = metricsFor(sixPerMonth(5));
    const gap = expectedGapDays(m)!;
    expect(gap).toBeGreaterThan(4);
    expect(gap).toBeLessThan(7);
  });

  it('flags a heavy client after weeks, not months', () => {
    // ~6/mo, silent 41 days — the case the blanket 3-month rule missed entirely.
    const m = metricsFor(sixPerMonth(41));
    expect(isGoneQuiet(m)).toBe(true);
    const s = deriveSignal(m);
    expect(s.kind).toBe('quiet');
    expect(s.label).toBe('Quiet 41 days');
    expect(s.detail).toContain('/mo');
    expect(s.detail).toContain('41 days');
  });

  it('does NOT flag the same client at a normal-for-them gap', () => {
    expect(isGoneQuiet(metricsFor(sixPerMonth(9)))).toBe(false);
  });

  it('gives an occasional client a correspondingly long leash', () => {
    // 4 orders spread over ~2 years: roughly one every 6 months.
    const occasional = [order(1, 30), order(2, 210), order(3, 400), order(4, 600)];
    const m = metricsFor(occasional);
    const threshold = quietAfterDays(m)!;
    expect(threshold).toBeGreaterThan(QUIET_MIN_DAYS);
    // 30 days of silence is nothing for this client.
    expect(isGoneQuiet(m)).toBe(false);
  });

  it('clamps the window at both ends', () => {
    expect(QUIET_MIN_DAYS).toBe(21);
    expect(QUIET_MAX_DAYS).toBe(180);
    expect(QUIET_GAP_MULTIPLE).toBe(3);

    // Very heavy client: 3x a ~1.5-day gap is under the floor, so the floor wins.
    const heavy: ClientOrderRow[] = Array.from({ length: 200 }, (_, i) => order(i + 1, 5 + i * 1.5));
    expect(quietAfterDays(metricsFor(heavy))).toBe(QUIET_MIN_DAYS);

    // Very light client: 3x a huge gap is capped.
    const light = [order(1, 100), order(2, 500), order(3, 900)];
    expect(quietAfterDays(metricsFor(light))).toBe(QUIET_MAX_DAYS);
  });

  it('says nothing at all below the cadence minimum', () => {
    expect(MIN_ORDERS_FOR_CADENCE).toBe(3);
    const m = metricsFor([order(1, 400), order(2, 5)]);
    expect(isGoneQuiet(m)).toBe(false);
    const s = deriveSignal(m);
    expect(s.kind).toBe('unknown');
    expect(s.label).toBe('');
  });

  it('an unlinked client is never quiet — unknown is not cold', () => {
    const m = metricsFor([], null);
    expect(isGoneQuiet(m)).toBe(false);
    expect(deriveSignal(m).kind).toBe('unknown');
  });
});

// ─── Momentum ───────────────────────────────────────────────────────────────

describe('momentum is measured against the client’s own average', () => {
  it('fires when this month clearly beats their baseline', () => {
    // ~2/mo baseline over a year, then 4 already this month.
    const rows: ClientOrderRow[] = [];
    for (let i = 0; i < 24; i++) rows.push(order(100 + i, 15 + i * 15));
    rows.push(order(1, 0), order(2, 1), order(3, 2), order(4, 2));

    const m = metricsFor(rows);
    expect(hasMomentum(m)).toBe(true);
    const s = deriveSignal(m);
    expect(s.kind).toBe('momentum');
    expect(s.tone).toBe('success');
    expect(s.detail).toContain('4 this month');
  });

  it('does not call a single order a surge', () => {
    const rows: ClientOrderRow[] = [];
    for (let i = 0; i < 6; i++) rows.push(order(100 + i, 40 + i * 60));
    rows.push(order(1, 1));
    expect(hasMomentum(metricsFor(rows))).toBe(false);
  });

  it('a quiet client is never also "momentum"', () => {
    const m = metricsFor(sixPerMonth(60));
    expect(isGoneQuiet(m)).toBe(true);
    expect(hasMomentum(m)).toBe(false);
    expect(deriveSignal(m).kind).toBe('quiet');
  });
});

// ─── Chip tones — what the row actually renders ─────────────────────────────

describe('chip tone per state', () => {
  it('a declining client renders the WARNING chip', () => {
    // 2 orders in the last 90, 9 in the prior 90 — a real fall.
    const rows = [
      order(1, 10), order(2, 40),
      order(3, 100), order(4, 110), order(5, 120), order(6, 130),
      order(7, 140), order(8, 150), order(9, 160), order(10, 170), order(11, 175),
    ];
    const s = deriveSignal(metricsFor(rows));
    expect(s.kind).toBe('declining');
    expect(s.tone).toBe('warning');
    expect(s.label).toMatch(/^Down \d+%$/);
  });

  it('a healthy climbing client renders the SUCCESS chip', () => {
    // NOW is the 3rd of the month, so only 0-2 days ago counts as "this month".
    const rows: ClientOrderRow[] = [];
    for (let i = 0; i < 18; i++) rows.push(order(100 + i, 20 + i * 20));
    rows.push(order(1, 0), order(2, 1), order(3, 2));
    const s = deriveSignal(metricsFor(rows));
    expect(s.kind).toBe('momentum');
    expect(s.tone).toBe('success');
  });

  it('a gone-quiet client renders the WARNING chip', () => {
    const s = deriveSignal(metricsFor(sixPerMonth(45)));
    expect(s.kind).toBe('quiet');
    expect(s.tone).toBe('warning');
  });

  it('an ordinary client renders the NEUTRAL chip', () => {
    // Flat: 6 in the last 90, 6 in the prior 90, last order recent.
    const rows = [
      order(1, 5), order(2, 20), order(3, 35), order(4, 50), order(5, 65), order(6, 80),
      order(7, 95), order(8, 110), order(9, 125), order(10, 140), order(11, 155), order(12, 170),
    ];
    const s = deriveSignal(metricsFor(rows));
    expect(s.kind).toBe('steady');
    expect(s.tone).toBe('neutral');
  });

  it('is deterministic', () => {
    const rows = sixPerMonth(41);
    expect(deriveSignal(metricsFor(rows))).toEqual(deriveSignal(metricsFor(rows)));
  });
});

// ─── The chip must never contradict the snapshot beside it ──────────────────

describe('the chip agrees with the health snapshot on the same screen', () => {
  it('never says "Steady" while the 90-day trend is up', () => {
    // Real case: 47 orders in the last 90 vs 29 in the prior 90 (+62%), read on
    // the 4th of the month, so month-to-date cannot yet beat a ~6/mo average.
    // The first cut of this rule rendered "Steady" next to "Trending up +62%".
    const rows: ClientOrderRow[] = [];
    for (let i = 0; i < 47; i++) rows.push(order(i + 1, Math.floor(i * 1.9)));
    for (let i = 0; i < 29; i++) rows.push(order(200 + i, 92 + Math.floor(i * 3)));

    const m = metricsFor(rows);
    expect(m.trend.direction).toBe('up');

    const s = deriveSignal(m);
    expect(s.kind).toBe('momentum');
    expect(s.tone).toBe('success');
    expect(s.label).toMatch(/^Up \d+%$/);
  });

  it('every up-trending client with a cadence reads as momentum, not steady', () => {
    const rows: ClientOrderRow[] = [];
    for (let i = 0; i < 20; i++) rows.push(order(i + 1, 5 + i * 4));
    for (let i = 0; i < 8; i++) rows.push(order(100 + i, 95 + i * 10));
    const m = metricsFor(rows);
    if (m.trend.direction === 'up') {
      expect(deriveSignal(m).kind).not.toBe('steady');
    }
  });

  it('still prefers the month-to-date framing when the month has out-run the average', () => {
    const rows: ClientOrderRow[] = [];
    for (let i = 0; i < 24; i++) rows.push(order(100 + i, 15 + i * 15));
    rows.push(order(1, 0), order(2, 1), order(3, 2), order(4, 2));
    const s = deriveSignal(metricsFor(rows));
    expect(s.kind).toBe('momentum');
    expect(s.detail).toContain('this month');
  });
});
