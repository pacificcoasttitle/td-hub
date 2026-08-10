import { describe, expect, it } from 'vitest';
import {
  formatCounty,
  formatOrderAddress,
  formatOrderMoney,
  isMeaningfulMoney,
  isPurchaseTransaction,
  isRefinanceTransaction,
} from './order-format';

describe('transaction-type predicates', () => {
  it('recognises a refinance regardless of casing or padding', () => {
    for (const v of ['Refinance', 'refinance', 'REFINANCE', '  Refinance  ']) {
      expect(isRefinanceTransaction(v)).toBe(true);
    }
  });

  it('does not treat anything else as a refinance', () => {
    // Notably 'Equity' — some order-entry forms group it with refi, but the
    // orders table only ever stores Purchase / Refinance / Other, and hiding
    // fields on an unrecognised type would hide a real gap.
    for (const v of ['Purchase', 'Other', 'Equity', '', null, undefined]) {
      expect(isRefinanceTransaction(v)).toBe(false);
    }
  });

  it('recognises a purchase the same way', () => {
    expect(isPurchaseTransaction('  PURCHASE ')).toBe(true);
    expect(isPurchaseTransaction('Refinance')).toBe(false);
    expect(isPurchaseTransaction(null)).toBe(false);
  });
});

describe('isMeaningfulMoney', () => {
  it('rejects the shapes that mean "no number here"', () => {
    // '0.00' is the one that matters: SoftPro sends SalesPrice "0" on refis.
    for (const v of [null, undefined, '', '   ', '0', '0.00', '$0', '$0.00', '—', '-', 'n/a', 'N/A']) {
      expect(isMeaningfulMoney(v)).toBe(false);
    }
  });

  it('accepts real amounts, formatted or raw', () => {
    for (const v of ['500000.00', '$500,000', '565000', ' $1,250,000.50 ']) {
      expect(isMeaningfulMoney(v)).toBe(true);
    }
  });
});

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
