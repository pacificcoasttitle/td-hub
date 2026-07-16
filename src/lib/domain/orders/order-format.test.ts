import { describe, expect, it } from 'vitest';
import { formatCounty, formatOrderAddress, formatOrderMoney } from './order-format';

describe('order money formatter', () => {
  it('formats USD with commas and no cents', () => {
    expect(formatOrderMoney(490000)).toBe('$490,000');
    expect(formatOrderMoney('1234.56')).toBe('$1,235');
    expect(formatOrderMoney(0)).toBe('$0');
  });

  it('uses the shared empty state for nullish and invalid amounts', () => {
    expect(formatOrderMoney(null)).toBe('—');
    expect(formatOrderMoney(undefined)).toBe('—');
    expect(formatOrderMoney('not-a-number')).toBe('—');
  });
});

describe('order address formatter', () => {
  it('assembles address components without county', () => {
    expect(formatOrderAddress({
      address: '123 Main St',
      line2: 'Unit 4',
      city: 'Glendale',
      state: 'CA',
      zip: '91203',
      county: 'Los Angeles',
    })).toBe('123 Main St Unit 4, Glendale, CA 91203');
  });

  it('falls back to fullAddress when components are missing', () => {
    expect(formatOrderAddress({
      fullAddress: '456 Oak Ave, Pasadena, CA 91101',
      county: 'Los Angeles',
    })).toBe('456 Oak Ave, Pasadena, CA 91101');
  });

  it('keeps county separate from the address string', () => {
    const property = {
      address: '789 Pine Rd',
      city: 'Downey',
      state: 'CA',
      zip: '90241',
      county: 'Los Angeles',
    };

    expect(formatOrderAddress(property)).toBe('789 Pine Rd, Downey, CA 90241');
    expect(formatOrderAddress(property)).not.toContain('Los Angeles');
    expect(formatCounty(property.county)).toBe('Los Angeles');
  });
});
