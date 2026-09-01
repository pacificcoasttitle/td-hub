import { describe, expect, it } from 'vitest';
import { rankFirmMatches, scoreCompanyMatch } from './company-near-match';

describe('company-near-match', () => {
  it('Wells Fargo matches Wells Fargo Bank by contains, not exact-only', () => {
    const hit = scoreCompanyMatch(
      { name: 'Wells Fargo' },
      { name: 'Wells Fargo Bank', address1: '420 Montgomery' },
    );
    expect(hit?.reason).toBe('contains');
    expect(hit!.score).toBeGreaterThanOrEqual(70);
  });

  it('exact name + address is a hard duplicate', () => {
    const hit = scoreCompanyMatch(
      { name: 'Wells Fargo Bank', address1: '123 Main Street' },
      { name: 'Wells Fargo Bank', address1: '123 Main Street' },
    );
    expect(hit).toEqual({ score: 100, reason: 'exact_name_address' });
  });

  it('ranks the contained name above a weak token overlap', () => {
    const ranked = rankFirmMatches(
      { name: 'Wells Fargo' },
      [
        { id: 1, name: 'Fargo Plumbing', lookupCode: 'Farg1', address1: null, city: null, state: null, zip: null, phone: null, email: null },
        { id: 2, name: 'Wells Fargo Bank', lookupCode: 'Well123M', address1: null, city: null, state: null, zip: null, phone: null, email: null },
      ],
    );
    expect(ranked[0]?.id).toBe(2);
    expect(ranked[0]?.reason).toBe('contains');
  });
});
