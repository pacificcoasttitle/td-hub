import { describe, expect, it } from 'vitest';
import {
  CPL_QUEUE_STATUSES, DEFAULT_QUEUE, HUB_QUEUES, formatQueueCount, hubQueue,
  isHubQueueId, queueAtPosition,
} from './hub-queues';
import { ACTIVE_ORDER_STATUSES } from './status-map';
import { pacificDayStart, pacificDayStartLiteral } from './hub-queue-filters';

describe('queue definitions', () => {
  it('has six queues at positions 1..6, matching the digit shortcuts', () => {
    expect(HUB_QUEUES).toHaveLength(6);
    expect(HUB_QUEUES.map((q) => q.position)).toEqual([1, 2, 3, 4, 5, 6]);
    for (let p = 1; p <= 6; p++) expect(queueAtPosition(p)?.position).toBe(p);
    expect(queueAtPosition(7)).toBeNull();
  });

  it('gives every queue a three-letter code and a unique id', () => {
    for (const q of HUB_QUEUES) expect(q.code).toHaveLength(3);
    expect(new Set(HUB_QUEUES.map((q) => q.id)).size).toBe(6);
  });

  it('recognises its own ids and rejects anything else', () => {
    expect(isHubQueueId('cplPending')).toBe(true);
    expect(isHubQueueId('nope')).toBe(false);
    expect(isHubQueueId(null)).toBe(false);
    expect(hubQueue(DEFAULT_QUEUE).code).toBe('TDY');
  });
});

describe('CPL queue status cohort', () => {
  // The point of this test is the trap, not the value. 'open' holds 2 rows out
  // of 7,300 because SoftPro opens everything straight into 'in_process'; three
  // features have shipped scoped to it and quietly did nothing. If someone
  // narrows this to a literal, this fails.
  it('is the shared ACTIVE cohort, not a hand-typed literal', () => {
    expect(CPL_QUEUE_STATUSES).toBe(ACTIVE_ORDER_STATUSES);
    expect([...CPL_QUEUE_STATUSES]).toContain('in_process');
  });
});

describe('formatQueueCount', () => {
  it('prints small counts exactly and abbreviates above 999', () => {
    expect(formatQueueCount(0)).toBe('0');
    expect(formatQueueCount(999)).toBe('999');
    expect(formatQueueCount(1021)).toBe('1k');
    expect(formatQueueCount(7301)).toBe('7.3k');
    expect(formatQueueCount(12400)).toBe('12k');
  });
});

describe('opened-today boundary', () => {
  it('is midnight Pacific, expressed as the UTC instant', () => {
    // 7am UTC on a PDT day is midnight Pacific.
    expect(pacificDayStart(new Date('2026-08-24T20:00:00.000Z')).toISOString())
      .toBe('2026-08-24T07:00:00.000Z');
    // Still the same Pacific day at 6:37pm local, even though it is the 25th UTC.
    expect(pacificDayStart(new Date('2026-08-25T01:37:00.000Z')).toISOString())
      .toBe('2026-08-24T07:00:00.000Z');
  });

  it('shifts an hour across the DST boundary rather than assuming -08:00', () => {
    // PST: midnight Pacific is 08:00Z. PDT: 07:00Z.
    expect(pacificDayStart(new Date('2026-01-15T20:00:00.000Z')).toISOString())
      .toBe('2026-01-15T08:00:00.000Z');
    expect(pacificDayStart(new Date('2026-07-15T20:00:00.000Z')).toISOString())
      .toBe('2026-07-15T07:00:00.000Z');
  });

  it('renders as a naive timestamp literal, because opened_at has no time zone', () => {
    expect(pacificDayStartLiteral(new Date('2026-08-24T20:00:00.000Z')))
      .toBe('2026-08-24 07:00:00');
  });
});
