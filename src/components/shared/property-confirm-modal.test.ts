import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { initialPropertyConfirmState } from './property-confirm-modal';

describe('PropertyConfirmModal reset-on-open (M10)', () => {
  it('initial state is confirm with empty multi-match form', () => {
    const fresh = initialPropertyConfirmState();
    expect(fresh.state).toBe('confirm');
    expect(fresh.locations).toEqual([]);
    expect(fresh.pickingIndex).toBeNull();
  });

  it('returns a new locations array each call (no shared stale reference)', () => {
    const a = initialPropertyConfirmState();
    const b = initialPropertyConfirmState();
    a.locations.push({ address: '1 Main', city: 'Irvine', state: 'CA', zip: '92618', apn: '' });
    expect(b.locations).toEqual([]);
  });

  it('resets internal state in a useEffect keyed on open (+ address)', () => {
    const src = readFileSync(join(__dirname, 'property-confirm-modal.tsx'), 'utf8');
    expect(src).toContain('initialPropertyConfirmState()');
    expect(src).toContain('queueMicrotask');
    expect(src).toMatch(/\}, \[open, address\.street, address\.city, address\.state, address\.zip\]\)/);
  });
});
