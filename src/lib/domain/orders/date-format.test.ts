import { describe, expect, it } from 'vitest';
import { formatOrderDate, formatOrderDateTime } from './date-format';

describe('order date formatter', () => {
  it('formats a normal date in canonical order format', () => {
    expect(formatOrderDate('2026-07-15T18:00:00.000Z')).toBe('Jul 15, 2026');
    expect(formatOrderDate('2026-07-15')).toBe('Jul 15, 2026');
  });

  it('returns the shared empty state for null, empty, and invalid values', () => {
    expect(formatOrderDate(null)).toBe('—');
    expect(formatOrderDate('')).toBe('—');
    expect(formatOrderDate('not-a-date')).toBe('—');
  });

  it('pins near-midnight timestamps to the America/Los_Angeles calendar day', () => {
    expect(formatOrderDate('2026-07-16T06:30:00.000Z')).toBe('Jul 15, 2026');
  });

  it('formats date-time values in the same timezone', () => {
    expect(formatOrderDateTime('2026-07-16T06:30:00.000Z')).toBe('Jul 15, 2026, 11:30 PM');
  });
});
