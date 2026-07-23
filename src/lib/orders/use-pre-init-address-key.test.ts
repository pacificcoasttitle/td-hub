import { describe, expect, it } from 'vitest';
import { buildPreInitAddressKey } from './use-pre-init-on-sitex';

describe('buildPreInitAddressKey', () => {
  it('is stable for the same address (invalidate no-ops on same key)', () => {
    const a = buildPreInitAddressKey({
      address: '123 Main St',
      city: 'Glendale',
      state: 'CA',
      zip: '91203',
      apn: '1234',
    });
    const b = buildPreInitAddressKey({
      address: ' 123 Main St ',
      city: 'Glendale',
      state: 'ca',
      zip: '91203',
      apn: '1234',
    });
    expect(a).toBe(b);
  });

  it('changes when street/apn changes (invalidate must fire)', () => {
    const base = buildPreInitAddressKey({
      address: '123 Main St',
      city: 'Glendale',
      state: 'CA',
      zip: '91203',
      apn: '1234',
    });
    const edited = buildPreInitAddressKey({
      address: '456 Oak Ave',
      city: 'Glendale',
      state: 'CA',
      zip: '91203',
      apn: '1234',
    });
    expect(edited).not.toBe(base);
  });
});
