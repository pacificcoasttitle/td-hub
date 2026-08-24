import { describe, expect, it } from 'vitest';
import { fmt } from './profile-document';

/**
 * Five formatting defects found by reading a generated PDF. Each one is here so
 * it cannot come back — they are invisible to type checking and only show up on
 * the page.
 */
describe('year formatting', () => {
  it('never applies a thousands separator — years are labels, not quantities', () => {
    expect(fmt.year(1948)).toBe('1948');
    expect(fmt.year(2024)).toBe('2024');
    expect(fmt.year(1947)).toBe('1947');
  });

  it('is not the quantity formatter', () => {
    expect(fmt.numf(1948)).toBe('1,948');   // what a year must NOT look like
    expect(fmt.year(1948)).not.toBe('1,948');
  });

  it('renders a gap when absent', () => {
    expect(fmt.year(null)).toBe('—');
    expect(fmt.year(undefined)).toBe('—');
  });
});

describe('square feet — one format everywhere', () => {
  it('building area and lot size format identically', () => {
    expect(fmt.sqft(1487)).toBe('1,487 sf');
    expect(fmt.sqft(6625)).toBe('6,625 sf');
  });

  it('never emits the provider\u2019s "6625 SF" shape', () => {
    expect(fmt.sqft(6625)).not.toBe('6625 SF');
  });

  it('renders a gap when absent', () => {
    expect(fmt.sqft(null)).toBe('—');
  });
});

describe('miles pluralisation', () => {
  it('says "1 mile", never "1 mile(s)"', () => {
    expect(fmt.miles(1)).toBe('1 mile');
    expect(fmt.miles(1)).not.toContain('(s)');
  });

  it('pluralises everything else', () => {
    expect(fmt.miles(2)).toBe('2 miles');
    expect(fmt.miles(0.5)).toBe('0.5 miles');
    expect(fmt.miles(0)).toBe('0 miles');
  });

  it('renders a gap when absent', () => {
    expect(fmt.miles(null)).toBe('—');
  });
});

describe('compact money for tight tiles', () => {
  it('keeps a price range short enough not to overflow', () => {
    // "$697,000–$835,000" overran its tile and collided with the next one.
    const long = `${fmt.money(697000)}–${fmt.money(835000)}`;
    const short = `${fmt.moneyShort(697000)}–${fmt.moneyShort(835000)}`;
    expect(short).toBe('$697k–$835k');
    expect(short.length).toBeLessThan(long.length);
  });

  it('scales into millions', () => {
    expect(fmt.moneyShort(1_250_000)).toBe('$1.3M');
    expect(fmt.moneyShort(12_000_000)).toBe('$12M');
  });

  it('renders a gap when absent or non-positive', () => {
    expect(fmt.moneyShort(null)).toBe('—');
    expect(fmt.moneyShort(0)).toBe('—');
  });
});
