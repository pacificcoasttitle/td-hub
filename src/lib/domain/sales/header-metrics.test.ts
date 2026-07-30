import { describe, expect, it } from 'vitest';
import {
  bucketDailyClosings,
  closedDateKey,
  computeDeltas,
  monthDailyAverage,
  sixMonthSeries,
  summariseSevenDays,
  type TrendsLike,
} from './header-metrics';

const m = (month: number, revenue: number, openings = 0, closings = 0) =>
  ({ month, revenue, openings, closings });

const TRENDS: TrendsLike = {
  currentYear: {
    year: 2026,
    months: [m(1, 30_000), m(2, 32_000), m(3, 41_000), m(4, 47_000), m(5, 44_000), m(6, 52_000), m(7, 60_230)],
  },
  priorYear: {
    year: 2025,
    months: [m(7, 55_000), m(11, 20_000), m(12, 25_000)],
  },
};

const JULY_30 = new Date(2026, 6, 30);

describe('computeDeltas', () => {
  it('compares the PROJECTED month against complete prior months', () => {
    const { mom, yoy } = computeDeltas(TRENDS, 65_966, JULY_30);
    // 65,966 vs June 52,000 -> +27%; vs Jul '25 55,000 -> +20%
    expect(mom).toMatchObject({ pct: 27, up: true, label: 'vs Jun' });
    expect(yoy).toMatchObject({ pct: 20, up: true, label: "vs Jul '25" });
  });

  it('carries the full basis so the compact chip never has to imply it', () => {
    const { mom } = computeDeltas(TRENDS, 65_966, JULY_30);
    expect(mom!.basis).toBe('Projected $65,966 this month vs $52,000 in Jun');
  });

  it('marks a decline as down', () => {
    const { mom } = computeDeltas(TRENDS, 40_000, JULY_30);
    expect(mom).toMatchObject({ pct: -23, up: false });
  });

  it('omits both chips when there is no projection (never fabricates a basis)', () => {
    expect(computeDeltas(TRENDS, null, JULY_30)).toEqual({ mom: null, yoy: null });
    expect(computeDeltas(TRENDS, undefined, JULY_30)).toEqual({ mom: null, yoy: null });
  });

  it('omits a chip whose comparison month is missing', () => {
    const sparse: TrendsLike = {
      currentYear: { year: 2026, months: [m(7, 60_000)] },      // no June
      priorYear: { year: 2025, months: [] },                    // no Jul '25
    };
    expect(computeDeltas(sparse, 65_000, JULY_30)).toEqual({ mom: null, yoy: null });
  });

  it('rolls back into the prior year for a January month-over-month', () => {
    const jan = new Date(2026, 0, 15);
    const { mom } = computeDeltas(TRENDS, 30_000, jan);
    // vs Dec '25 = 25,000 -> +20%
    expect(mom).toMatchObject({ pct: 20, label: 'vs Dec' });
  });

  it('omits rather than dividing by a zero baseline', () => {
    const zeroBase: TrendsLike = {
      currentYear: { year: 2026, months: [m(6, 0), m(7, 10)] },
      priorYear: { year: 2025, months: [] },
    };
    expect(computeDeltas(zeroBase, 10, JULY_30).mom).toBeNull();
  });

  it('returns nothing without trends', () => {
    expect(computeDeltas(null, 65_966, JULY_30)).toEqual({ mom: null, yoy: null });
  });
});

describe('sixMonthSeries', () => {
  it('returns the trailing six months oldest-first ending on the current month', () => {
    expect(sixMonthSeries(TRENDS, 'revenue', JULY_30))
      .toEqual([32_000, 41_000, 47_000, 44_000, 52_000, 60_230]);
  });

  it('spans the year boundary', () => {
    const feb = new Date(2026, 1, 10);
    // Sep-Dec '25 missing except Nov/Dec, plus Jan/Feb '26
    expect(sixMonthSeries(TRENDS, 'revenue', feb)).toEqual([20_000, 25_000, 30_000, 32_000]);
  });

  it('returns null when a line cannot be drawn', () => {
    const one: TrendsLike = { currentYear: { year: 2026, months: [m(7, 1)] }, priorYear: { year: 2025, months: [] } };
    expect(sixMonthSeries(one, 'revenue', JULY_30)).toBeNull();
    expect(sixMonthSeries(null, 'revenue', JULY_30)).toBeNull();
  });
});

describe('closedDateKey', () => {
  it('takes the calendar date without timezone drift', () => {
    expect(closedDateKey('2026-07-28T23:30:00.000Z')).toBe('2026-07-28');
    expect(closedDateKey('2026-07-28')).toBe('2026-07-28');
  });
  it('rejects junk', () => {
    expect(closedDateKey('')).toBeNull();
    expect(closedDateKey('not a date')).toBeNull();
  });
});

describe('bucketDailyClosings', () => {
  const entries = [
    { closedDate: '2026-07-30', revenue: 1000 },
    { closedDate: '2026-07-30', revenue: 500 },
    { closedDate: '2026-07-28', revenue: 2000 },
    { closedDate: '2026-07-24', revenue: 300 },   // oldest day in window
    { closedDate: '2026-07-01', revenue: 999 },   // outside the window
  ];

  it('produces seven consecutive days ending today, oldest first', () => {
    const days = bucketDailyClosings(entries, JULY_30, 7);
    expect(days).toHaveLength(7);
    expect(days[0].date).toBe('2026-07-24');
    expect(days[6].date).toBe('2026-07-30');
    expect(days[6].isLatest).toBe(true);
    expect(days.filter(d => d.isLatest)).toHaveLength(1);
  });

  it('counts closings and sums revenue per day', () => {
    const days = bucketDailyClosings(entries, JULY_30, 7);
    expect(days[6]).toMatchObject({ closings: 2, revenue: 1500 });
    expect(days[4]).toMatchObject({ date: '2026-07-28', closings: 1, revenue: 2000 });
  });

  it('keeps empty days as zeros rather than dropping them', () => {
    const days = bucketDailyClosings(entries, JULY_30, 7);
    const empty = days.filter(d => d.closings === 0);
    expect(empty.length).toBe(4);
    expect(empty.every(d => d.revenue === 0)).toBe(true);
  });

  it('excludes closings outside the window', () => {
    const days = bucketDailyClosings(entries, JULY_30, 7);
    expect(days.some(d => d.date === '2026-07-01')).toBe(false);
  });

  it('labels weekdays', () => {
    const days = bucketDailyClosings([], JULY_30, 7);
    expect(days[6].dow).toBe('Thu'); // 2026-07-30 is a Thursday
  });

  it('handles no entries at all', () => {
    const days = bucketDailyClosings([], JULY_30, 7);
    expect(days).toHaveLength(7);
    expect(days.every(d => d.closings === 0)).toBe(true);
  });
});

describe('monthDailyAverage', () => {
  it('divides month closings by business days elapsed', () => {
    // July 2026: 1st is a Wednesday. Business days through the 30th = 22.
    const entries = Array.from({ length: 44 }, () => ({ closedDate: '2026-07-15', revenue: 0 }));
    expect(monthDailyAverage(entries, JULY_30)).toBeCloseTo(2, 5);
  });

  it('ignores closings from other months', () => {
    const entries = [
      { closedDate: '2026-06-15', revenue: 0 },
      { closedDate: '2026-07-15', revenue: 0 },
    ];
    const avg = monthDailyAverage(entries, JULY_30)!;
    expect(avg).toBeGreaterThan(0);
    expect(avg).toBeLessThan(0.1); // 1 closing over 22 business days
  });

  it('returns null with nothing to average', () => {
    expect(monthDailyAverage([], JULY_30)).toBeNull();
  });
});

describe('summariseSevenDays', () => {
  it('rolls up totals and picks the best day', () => {
    const s = summariseSevenDays([
      { closedDate: '2026-07-30', revenue: 100 },
      { closedDate: '2026-07-28', revenue: 200 },
      { closedDate: '2026-07-28', revenue: 300 },
    ], JULY_30);
    expect(s.totalClosings).toBe(3);
    expect(s.totalRevenue).toBe(600);
    expect(s.bestDay).toMatchObject({ date: '2026-07-28', closings: 2 });
  });

  it('has no best day when nothing closed', () => {
    const s = summariseSevenDays([], JULY_30);
    expect(s.totalClosings).toBe(0);
    expect(s.bestDay).toBeNull();
  });
});
