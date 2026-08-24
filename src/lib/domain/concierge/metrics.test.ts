import { describe, expect, it } from 'vitest';
import { DEFAULT_CRITERIA, type CompCandidate } from './comp-filter';
import { appliedRadiusMiles, computeMetrics, median, pricePerSqft } from './metrics';

let seq = 0;
function comp(over: Partial<CompCandidate> = {}): CompCandidate {
  return {
    sourcePosition: seq++, salePrice: 600_000, pricePerSqft: 400, buildingArea: 1500,
    bedrooms: 3, baths: 1, yearBuilt: 1950, lotSize: 6000, proximityMiles: 0.2,
    recordingDate: '2026-05-01', useCodeDescription: 'Single Family Residential',
    ...over,
  };
}

describe('FIX 3 — median is a real median', () => {
  it('odd count takes the middle value', () => {
    expect(median([10, 30, 20])).toBe(20);
  });

  /** The legacy bug: indexing the middle element is wrong on an even set. */
  it('EVEN count averages the two middle values', () => {
    expect(median([10, 20, 30, 40])).toBe(25);
    expect(median([1, 2])).toBe(1.5);
  });

  it('sorts numerically, not lexicographically', () => {
    // [9, 10, 100] sorted as strings gives "10","100","9" -> median "100".
    expect(median([100, 9, 10])).toBe(10);
  });

  it('returns null for an empty set rather than 0 or NaN', () => {
    expect(median([])).toBeNull();
  });

  it('ignores non-finite values', () => {
    expect(median([10, Number.NaN, 20, Number.POSITIVE_INFINITY, 30])).toBe(20);
  });
});

describe('FIX 1 — price per square foot comes from SiteX', () => {
  it('uses the vendor PricePerSQFT', () => {
    expect(pricePerSqft(comp({ pricePerSqft: 412.5 }))).toBe(412.5);
  });

  /**
   * The legacy bug: BuildingArea was printed in the price-per-sqft column, so a
   * "price per sq ft" of 1,850 was really the floor area. If the vendor figure
   * is absent we return null and the report shows a gap — we never derive it.
   */
  it('returns null when the vendor omits it — never derives from area', () => {
    const c = comp({ pricePerSqft: null, salePrice: 600_000, buildingArea: 1500 });
    expect(pricePerSqft(c)).toBeNull();
    // 600000/1500 = 400 — the number we are deliberately NOT producing.
    expect(pricePerSqft(c)).not.toBe(400);
  });

  it('never returns the building area', () => {
    const c = comp({ pricePerSqft: null, buildingArea: 1850 });
    expect(pricePerSqft(c)).not.toBe(1850);
  });

  it('treats zero or negative as absent', () => {
    expect(pricePerSqft(comp({ pricePerSqft: 0 }))).toBeNull();
    expect(pricePerSqft(comp({ pricePerSqft: -5 }))).toBeNull();
  });
});

describe('FIX 2 — radius is the radius we applied', () => {
  it('reports the criterion, not anything measured', () => {
    expect(appliedRadiusMiles({ ...DEFAULT_CRITERIA, radiusMiles: 1 })).toBe(1);
  });

  /** Legacy added min + max proximity and printed the sum — not any real quantity. */
  it('does not add, average, or otherwise derive from the comps', () => {
    const selected = [comp({ proximityMiles: 0.24 }), comp({ proximityMiles: 0.45 })];
    const m = computeMetrics(selected, { ...DEFAULT_CRITERIA, radiusMiles: 1 });
    expect(m.appliedRadiusMiles).toBe(1);
    expect(m.appliedRadiusMiles).not.toBe(0.69); // min + max
    expect(m.appliedRadiusMiles).not.toBe(0.45); // max alone
    // The observed spread is still reported — as an observation, separately.
    expect(m.furthestSelectedMiles).toBe(0.45);
  });
});

describe('computeMetrics', () => {
  it('computes from the SELECTED set only', () => {
    const selected = [comp({ salePrice: 500_000 }), comp({ salePrice: 700_000 })];
    const m = computeMetrics(selected, DEFAULT_CRITERIA);
    expect(m.basedOnComps).toBe(2);
    expect(m.medianSalePrice).toBe(600_000);
    expect(m.priceRangeMin).toBe(500_000);
    expect(m.priceRangeMax).toBe(700_000);
  });

  it('counts comps missing a vendor price-per-sqft so the gap is visible', () => {
    const m = computeMetrics([comp(), comp({ pricePerSqft: null }), comp({ pricePerSqft: null })], DEFAULT_CRITERIA);
    expect(m.compsMissingPricePerSqft).toBe(2);
    expect(m.medianPricePerSqft).toBe(400);
  });

  it('returns nulls, not zeros, when there is nothing to measure', () => {
    const m = computeMetrics([], DEFAULT_CRITERIA);
    expect(m.basedOnComps).toBe(0);
    expect(m.medianSalePrice).toBeNull();
    expect(m.medianPricePerSqft).toBeNull();
    expect(m.priceRangeMin).toBeNull();
    expect(m.furthestSelectedMiles).toBeNull();
    // The applied criterion is still reported — it does not depend on results.
    expect(m.appliedRadiusMiles).toBe(DEFAULT_CRITERIA.radiusMiles);
  });

  it('rounds median year to a whole year', () => {
    const m = computeMetrics([comp({ yearBuilt: 1948 }), comp({ yearBuilt: 1951 })], DEFAULT_CRITERIA);
    expect(m.medianYearBuilt).toBe(1950); // (1948+1951)/2 = 1949.5 -> 1950
    expect(Number.isInteger(m.medianYearBuilt)).toBe(true);
  });
});
