import { describe, expect, it } from 'vitest';
import {
  formatDayLabel, pacificMidnightUtc, pacificYmd, previousPacificDay,
} from './calendar-day';

describe('pacificMidnightUtc', () => {
  it('resolves midnight during PDT (UTC-7)', () => {
    expect(pacificMidnightUtc({ year: 2026, month: 7, day: 30 }).toISOString())
      .toBe('2026-07-30T07:00:00.000Z');
  });

  it('resolves midnight during PST (UTC-8)', () => {
    expect(pacificMidnightUtc({ year: 2026, month: 1, day: 15 }).toISOString())
      .toBe('2026-01-15T08:00:00.000Z');
  });

  it('handles the spring-forward day (clocks jump at 2am, midnight is still PST)', () => {
    // DST begins Sunday March 8, 2026.
    expect(pacificMidnightUtc({ year: 2026, month: 3, day: 8 }).toISOString())
      .toBe('2026-03-08T08:00:00.000Z');
  });

  it('handles the fall-back day (midnight is still PDT)', () => {
    // DST ends Sunday November 1, 2026.
    expect(pacificMidnightUtc({ year: 2026, month: 11, day: 1 }).toISOString())
      .toBe('2026-11-01T07:00:00.000Z');
  });
});

describe('previousPacificDay', () => {
  it('covers the whole prior day when run at 6am Pacific', () => {
    // 2026-07-31 13:00Z == 6am PDT on Jul 31
    const w = previousPacificDay(new Date('2026-07-31T13:00:00Z'));
    expect(w.ymd).toEqual({ year: 2026, month: 7, day: 30 });
    expect(w.start.toISOString()).toBe('2026-07-30T07:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-07-31T07:00:00.000Z');
  });

  it('is exactly 24h on an ordinary day', () => {
    const w = previousPacificDay(new Date('2026-07-31T13:00:00Z'));
    expect(w.end.getTime() - w.start.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it('is 23 hours across spring forward', () => {
    // Reporting on Sunday Mar 8 2026, run Mar 9.
    const w = previousPacificDay(new Date('2026-03-09T13:00:00Z'));
    expect(w.ymd).toEqual({ year: 2026, month: 3, day: 8 });
    expect(w.end.getTime() - w.start.getTime()).toBe(23 * 60 * 60 * 1000);
  });

  it('is 25 hours across fall back', () => {
    // Reporting on Sunday Nov 1 2026, run Nov 2.
    const w = previousPacificDay(new Date('2026-11-02T14:00:00Z'));
    expect(w.ymd).toEqual({ year: 2026, month: 11, day: 1 });
    expect(w.end.getTime() - w.start.getTime()).toBe(25 * 60 * 60 * 1000);
  });

  it('rolls back across a month boundary', () => {
    const w = previousPacificDay(new Date('2026-08-01T13:00:00Z'));
    expect(w.ymd).toEqual({ year: 2026, month: 7, day: 31 });
  });

  it('rolls back across a year boundary', () => {
    const w = previousPacificDay(new Date('2026-01-01T14:00:00Z'));
    expect(w.ymd).toEqual({ year: 2025, month: 12, day: 31 });
  });

  it('still reports the prior day if the send runs late in the morning', () => {
    // 17:00Z == 10am PDT — same reported day as a 6am run.
    const w = previousPacificDay(new Date('2026-07-31T17:00:00Z'));
    expect(w.ymd).toEqual({ year: 2026, month: 7, day: 30 });
  });
});

describe('pacificYmd', () => {
  it('reads the Pacific date, not the UTC date', () => {
    // 2026-07-31T05:00Z is still Jul 30 in Pacific time.
    expect(pacificYmd(new Date('2026-07-31T05:00:00Z')))
      .toEqual({ year: 2026, month: 7, day: 30 });
  });
});

describe('formatDayLabel', () => {
  it('renders a friendly day label', () => {
    expect(formatDayLabel({ year: 2026, month: 7, day: 30 })).toBe('Thursday, July 30');
  });
});
