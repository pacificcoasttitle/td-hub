import { describe, expect, it } from 'vitest';
import { SOFTPRO_SEARCH_ROW_CAP } from '@/lib/integrations/softpro/vendor-limits';
import {
  chunkDateRange,
  formatDateForSoftPro,
  maxChunkDaysUnderCap,
  PEAK_ORDERS_PER_DAY,
  SYNC_CHUNK_COUNT,
  SYNC_CHUNK_DAYS,
  SYNC_LOOKBACK_DAYS,
  SYNC_WINDOW_DAYS,
  syncWindow,
  syncWindowChunks,
} from './sync-window';

/** Every calendar date a list of chunks actually asks the vendor for. */
function datesCovered(chunks: Array<{ dateFrom: string; dateTo: string }>): string[] {
  const dates: string[] = [];
  for (const chunk of chunks) {
    const [fm, fd, fy] = chunk.dateFrom.split('-').map(Number);
    const [tm, td, ty] = chunk.dateTo.split('-').map(Number);
    for (
      let cursor = new Date(fy!, fm! - 1, fd!);
      cursor <= new Date(ty!, tm! - 1, td!);
      cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1)
    ) {
      dates.push(formatDateForSoftPro(cursor));
    }
  }
  return dates;
}

describe('the chunk size is derived from the vendor cap, not chosen', () => {
  it('sizes a chunk so the busiest measured day fits under the cap with headroom', () => {
    // 250 / (85 * 2) floors to one day. The value matters less than the fact
    // that changing the measured volume changes the chunk, which is what makes
    // the assumption reviewable instead of buried.
    expect(SYNC_CHUNK_DAYS).toBe(1);
    expect(PEAK_ORDERS_PER_DAY * SYNC_CHUNK_DAYS).toBeLessThan(SOFTPRO_SEARCH_ROW_CAP);
  });

  it('widens the chunk if the cap rises', () => {
    expect(maxChunkDaysUnderCap(1_000, 85, 2)).toBe(5);
  });

  it('narrows the chunk if volume rises', () => {
    expect(maxChunkDaysUnderCap(250, 40, 2)).toBe(3);
    expect(maxChunkDaysUnderCap(250, 120, 2)).toBe(1);
  });

  it('never returns less than a day, because a day is the finest slice the vendor offers', () => {
    // Past this point chunking alone cannot stay under the cap and the runtime
    // alarm is the only thing left. The floor makes that explicit rather than
    // producing a zero-day chunk and an empty call list.
    expect(maxChunkDaysUnderCap(250, 5_000, 2)).toBe(1);
  });

  it('derives the number of calls from the window and the chunk', () => {
    expect(SYNC_WINDOW_DAYS).toBe(SYNC_LOOKBACK_DAYS + 1);
    expect(SYNC_CHUNK_COUNT).toBe(Math.ceil(SYNC_WINDOW_DAYS / SYNC_CHUNK_DAYS));
  });
});

describe('the chunks cover exactly the window, no more and no less', () => {
  const now = new Date(2026, 7, 27, 9, 30);
  const chunks = syncWindowChunks(now);

  it('makes one call per day of the window', () => {
    expect(chunks).toHaveLength(SYNC_CHUNK_COUNT);
    expect(chunks).toHaveLength(8);
    for (const chunk of chunks) expect(chunk.dateFrom).toBe(chunk.dateTo);
  });

  it('covers every date from the oldest to today, with no gap', () => {
    // The window is the thing 221 orders were lost through. A chunk list that
    // skipped a date would reintroduce exactly that failure, one day narrower.
    expect(datesCovered(chunks)).toEqual([
      '08-20-2026', '08-21-2026', '08-22-2026', '08-23-2026',
      '08-24-2026', '08-25-2026', '08-26-2026', '08-27-2026',
    ]);
  });

  it('never asks for the same date twice', () => {
    const dates = datesCovered(chunks);
    expect(new Set(dates).size).toBe(dates.length);
  });

  it('keeps syncWindow and the chunks describing the same range', () => {
    // The ingest gap detector polices the range syncWindow reports. If the two
    // could disagree the detector would start auditing dates nobody fetched.
    const window = syncWindow(now);
    expect(window.dateFrom).toBe(chunks[0]!.dateFrom);
    expect(window.dateTo).toBe(chunks[chunks.length - 1]!.dateTo);
  });
});

describe('chunkDateRange over an arbitrary range', () => {
  it('partitions a range that does not divide evenly, without overrunning the end', () => {
    const chunks = chunkDateRange('08-01-2026', '08-07-2026', 3);
    expect(chunks).toEqual([
      { dateFrom: '08-01-2026', dateTo: '08-03-2026' },
      { dateFrom: '08-04-2026', dateTo: '08-06-2026' },
      { dateFrom: '08-07-2026', dateTo: '08-07-2026' },
    ]);
  });

  it('handles a single-day range', () => {
    expect(chunkDateRange('08-27-2026', '08-27-2026', 1))
      .toEqual([{ dateFrom: '08-27-2026', dateTo: '08-27-2026' }]);
  });

  it('crosses a month boundary', () => {
    expect(datesCovered(chunkDateRange('07-30-2026', '08-02-2026', 1)))
      .toEqual(['07-30-2026', '07-31-2026', '08-01-2026', '08-02-2026']);
  });

  it('crosses the daylight-saving boundary without losing or repeating a day', () => {
    // Millisecond arithmetic lands on the same local date twice across the
    // spring-forward boundary. A repeated date is wasted calls; a skipped one is
    // a day nobody ever asks the vendor for.
    const dates = datesCovered(chunkDateRange('11-01-2026', '11-03-2026', 1));
    expect(dates).toEqual(['11-01-2026', '11-02-2026', '11-03-2026']);
  });

  it('falls back to the caller\'s own range rather than fetching nothing', () => {
    expect(chunkDateRange('not-a-date', '08-27-2026'))
      .toEqual([{ dateFrom: 'not-a-date', dateTo: '08-27-2026' }]);
  });
});
