import { describe, expect, it } from 'vitest';
import { isConfidentSiteXMatch } from './confident-sitex';

describe('isConfidentSiteXMatch', () => {
  it('requires APN + county + legal', () => {
    expect(isConfidentSiteXMatch({
      apn: '1234-567-890',
      county: 'Los Angeles',
      legalDescription: 'Lot 1 Tract 99',
    })).toBe(true);
  });

  it('rejects missing APN (no-match grace — do not fire pre-init)', () => {
    expect(isConfidentSiteXMatch({
      apn: null,
      county: 'Los Angeles',
      legalDescription: 'Lot 1',
    })).toBe(false);
  });

  it('rejects whitespace-only fields', () => {
    expect(isConfidentSiteXMatch({
      apn: '  ',
      county: 'Orange',
      legalDescription: 'Lot 1',
    })).toBe(false);
  });
});
