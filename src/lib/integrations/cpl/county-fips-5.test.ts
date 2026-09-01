import { describe, expect, it } from 'vitest';
import { fips5From, countyFipsFrom } from './county-fips';

// ─── Two consumers, two shapes, one table ───────────────────────────────────
//
// Westcor's CountyFips is the 3-digit county portion ("095" paired with
// "Orange County"). SiteX's `fips` is the full 5-digit state+county code
// ("06037" for Los Angeles). Sending either one to the other is wrong.

describe('fips5From — the shape SiteX documents', () => {
  it('derives the 5-digit code from county and state', () => {
    expect(fips5From(null, 'Los Angeles', 'CA')).toBe('06037');
    expect(fips5From(null, 'San Bernardino', 'CA')).toBe('06071');
    expect(fips5From(null, 'Orange', 'CA')).toBe('06059');
    expect(fips5From(null, 'Maricopa', 'AZ')).toBe('04013');
    expect(fips5From(null, 'Clark', 'NV')).toBe('32003');
  });

  it('prefers a stored 5-digit SiteX code', () => {
    // SiteX returns "06037" itself; round-tripping it must not corrupt it.
    expect(fips5From('06037', 'Los Angeles', 'CA')).toBe('06037');
    expect(fips5From('06037', 'Orange', 'CA')).toBe('06037');
  });

  it('expands a stored 3-digit code using the state', () => {
    expect(fips5From('037', null, 'CA')).toBe('06037');
  });

  it('tolerates the county-name variants the data actually holds', () => {
    for (const n of ['Los Angeles', 'LOS ANGELES', 'Los Angeles County', 'los angeles county']) {
      expect(fips5From(null, n, 'CA'), n).toBe('06037');
    }
  });

  it('returns null rather than a malformed code', () => {
    expect(fips5From(null, null, 'CA')).toBeNull();
    expect(fips5From(null, 'Los Angeles', null)).toBeNull();
    expect(fips5From(null, 'Nowhere', 'CA')).toBeNull();
    expect(fips5From(null, 'Los Angeles', 'TX')).toBeNull();
    expect(fips5From('nonsense', 'Nowhere', 'ZZ')).toBeNull();
  });
});

describe('the two shapes stay distinct', () => {
  it('Westcor still gets 3 digits, SiteX 5, from the same inputs', () => {
    // The real failing orders: 4317-003-061 in Los Angeles,
    // 3093-521-31-0000 in San Bernardino.
    expect(countyFipsFrom(null, 'Los Angeles', 'CA')).toBe('037');
    expect(fips5From(null, 'Los Angeles', 'CA')).toBe('06037');
    expect(countyFipsFrom(null, 'San Bernardino', 'CA')).toBe('071');
    expect(fips5From(null, 'San Bernardino', 'CA')).toBe('06071');
  });
});
