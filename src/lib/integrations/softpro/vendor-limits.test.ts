import { describe, expect, it } from 'vitest';
import {
  describeSuspectedTruncation,
  isSuspectedTruncation,
  SOFTPRO_SEARCH_ROW_CAP,
} from './vendor-limits';

// The cap truncates silently: same HTTP 200, same "Success", no total and no
// cursor. A row count sitting exactly on the cap is the only signal there is, so
// these tests pin the boundary in both directions. An off-by-one either way
// makes the alarm useless — one direction never fires, the other fires on every
// ordinary day and gets muted.

describe('the truncation boundary', () => {
  it('fires at exactly the cap', () => {
    expect(isSuspectedTruncation(SOFTPRO_SEARCH_ROW_CAP)).toBe(true);
    expect(isSuspectedTruncation(250)).toBe(true);
  });

  it('does not fire one row below the cap', () => {
    expect(isSuspectedTruncation(SOFTPRO_SEARCH_ROW_CAP - 1)).toBe(false);
    expect(isSuspectedTruncation(249)).toBe(false);
  });

  it('does not fire one row above the cap', () => {
    // The vendor cannot exceed its own cap, so this means the cap moved and the
    // constant is stale. Equality leaves that visible instead of absorbing it.
    expect(isSuspectedTruncation(SOFTPRO_SEARCH_ROW_CAP + 1)).toBe(false);
    expect(isSuspectedTruncation(251)).toBe(false);
  });

  it('does not fire on an ordinary or empty response', () => {
    expect(isSuspectedTruncation(0)).toBe(false);
    expect(isSuspectedTruncation(50)).toBe(false);
  });

  it('keeps the vendor cap documented as a named constant', () => {
    expect(SOFTPRO_SEARCH_ROW_CAP).toBe(250);
  });
});

describe('what the alarm actually says', () => {
  const message = describeSuspectedTruncation({
    operation: 'GetOrders',
    dateFrom: '08-21-2026',
    dateTo: '08-21-2026',
    rowCount: 250,
  });

  it('reports the count as unreliable rather than claiming rows were lost', () => {
    // Someone reads this while deciding whether to act. A day that genuinely
    // holds exactly 250 orders is indistinguishable from a truncated one, so
    // asserting loss would be wrong the first time it happened.
    expect(message).toContain('unreliable');
    expect(message).toContain('not as a total');
    // The possibility of loss is offered as one of two readings, never asserted.
    expect(message).toMatch(/may hold exactly that many orders, or more that were dropped/);
    expect(message).not.toMatch(/\b(rows|orders) were lost\b/i);
    expect(message).not.toMatch(/\bwe lost\b/i);
  });

  it('names the range, the count, and the cap so it can be acted on', () => {
    expect(message).toContain('08-21-2026');
    expect(message).toContain('250');
    expect(message).toContain('GetOrders');
  });

  it('collapses a single-day range instead of repeating the date', () => {
    expect(message).not.toContain('08-21-2026 to 08-21-2026');
  });

  it('spells out a multi-day range', () => {
    const wide = describeSuspectedTruncation({
      operation: 'GetOrders',
      dateFrom: '08-20-2026',
      dateTo: '08-27-2026',
      rowCount: 250,
    });
    expect(wide).toContain('08-20-2026 to 08-27-2026');
  });
});
