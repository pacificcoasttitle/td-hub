import { describe, expect, it } from 'vitest';
import { STATUS_COLORS, STATUS_LABELS, STATUS_OPTS } from './orders-hub-parts';

describe('orders hub status helpers', () => {
  it('uses canonical canceled status for Hub filtering and labels', () => {
    expect(STATUS_OPTS).toContain('canceled');
    expect(STATUS_OPTS).not.toContain('cancelled');
    expect(STATUS_LABELS.canceled).toBe('Canceled');
    expect(STATUS_LABELS.cancelled).toBeUndefined();
    expect(STATUS_COLORS.canceled).toBe('bg-gray-100 text-gray-500 border-gray-200');
    expect(STATUS_COLORS.cancelled).toBeUndefined();
  });
});
