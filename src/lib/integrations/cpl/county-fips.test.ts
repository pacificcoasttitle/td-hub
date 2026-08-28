import { describe, expect, it } from 'vitest';
import { countyFips, countyFipsFrom } from './county-fips';

describe('the format is the 3-digit county code', () => {
  it('matches the spec example — Orange County FL is 12095, the field takes 095', () => {
    // Our equivalent: Los Angeles CA is 06037, so the field takes 037.
    expect(countyFips('Los Angeles', 'CA')).toBe('037');
    expect(countyFips('Orange', 'CA')).toBe('059');
  });

  it('reduces a stored 5-digit SiteX code to its county part', () => {
    expect(countyFipsFrom('06037', null, null)).toBe('037');
  });

  it('accepts a stored 3-digit code unchanged', () => {
    expect(countyFipsFrom('037', null, null)).toBe('037');
  });

  it('falls back to the lookup when the stored code is malformed', () => {
    // Better an absent identifier than a wrong one on a legal instrument.
    expect(countyFipsFrom('nonsense', 'Los Angeles', 'CA')).toBe('037');
    expect(countyFipsFrom('12', 'Los Angeles', 'CA')).toBe('037');
    expect(countyFipsFrom('', 'Los Angeles', 'CA')).toBe('037');
  });
});

describe('the case variants that are actually in the data', () => {
  it.each([
    ['Los Angeles', '037'], ['LOS ANGELES', '037'],
    ['Orange', '059'], ['ORANGE', '059'],
    ['San Bernardino', '071'], ['SAN BERNARDINO', '071'],
  ])('%s resolves', (name, fips) => {
    expect(countyFips(name, 'CA')).toBe(fips);
  });

  it('tolerates the " County" suffix our own CountyName adds', () => {
    expect(countyFips('Los Angeles County', 'CA')).toBe('037');
    expect(countyFips('LOS ANGELES COUNTY', 'CA')).toBe('037');
  });
});

describe('every state we operate in', () => {
  it('California', () => expect(countyFips('Kern', 'CA')).toBe('029'));
  it('Arizona', () => expect(countyFips('Maricopa', 'AZ')).toBe('013'));
  it('Nevada', () => expect(countyFips('Clark', 'NV')).toBe('003'));

  it('Santa Cruz is a real county in BOTH CA and AZ, with different codes', () => {
    // The reason the lookup is keyed on state and not county alone.
    expect(countyFips('Santa Cruz', 'CA')).toBe('087');
    expect(countyFips('Santa Cruz', 'AZ')).toBe('023');
  });

  it('Carson City is an independent city with a 510 code', () => {
    expect(countyFips('Carson City', 'NV')).toBe('510');
  });
});

describe('it abstains rather than guessing', () => {
  it.each([
    [null, 'CA'], ['Los Angeles', null], ['', 'CA'], ['Los Angeles', ''],
    ['Nowhere', 'CA'], ['Los Angeles', 'TX'],
  ])('countyFips(%s, %s) is null', (c, s) => {
    expect(countyFips(c, s)).toBeNull();
  });
});
