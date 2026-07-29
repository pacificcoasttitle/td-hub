import { describe, expect, it } from 'vitest';
import { fmtBusinessIndicator } from './clients-page-client';

describe('fmtBusinessIndicator', () => {
  it('formats count and last-order month', () => {
    expect(fmtBusinessIndicator({
      orderCount: 3,
      lastOpenedAt: '2026-05-14T00:00:00.000Z',
      lastClosedAt: null,
    })).toBe('3 orders · last May 2026');
  });

  it('uses singular for one order', () => {
    expect(fmtBusinessIndicator({
      orderCount: 1,
      lastOpenedAt: '2026-01-05T00:00:00.000Z',
      lastClosedAt: null,
    })).toBe('1 order · last Jan 2026');
  });

  it('omits the date when there is no last order date', () => {
    expect(fmtBusinessIndicator({ orderCount: 2, lastOpenedAt: null, lastClosedAt: null }))
      .toBe('2 orders');
  });

  it('returns null for unlinked or empty business', () => {
    expect(fmtBusinessIndicator(null)).toBeNull();
    expect(fmtBusinessIndicator({ orderCount: 0, lastOpenedAt: null, lastClosedAt: null })).toBeNull();
  });
});
