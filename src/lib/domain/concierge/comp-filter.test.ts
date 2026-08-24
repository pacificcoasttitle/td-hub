import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CRITERIA, selectComps,
  type CompCandidate, type CompCriteria, type SubjectFacts,
} from './comp-filter';

// The subject from the real report-187 pull: 1,487 sf, 3 bd, 1 ba, SFR.
const SUBJECT: SubjectFacts = {
  buildingArea: 1487, bedrooms: 3, baths: 1,
  useCodeDescription: 'Single Family Residential',
};
const AS_OF = new Date('2026-08-24T00:00:00Z');

let seq = 0;
function comp(over: Partial<CompCandidate> = {}): CompCandidate {
  return {
    sourcePosition: seq++,
    salePrice: 600_000, pricePerSqft: 400, buildingArea: 1500,
    bedrooms: 3, baths: 1, yearBuilt: 1950, lotSize: 6000,
    proximityMiles: 0.2, recordingDate: '2026-05-01',
    useCodeDescription: 'Single Family Residential',
    ...over,
  };
}

describe('selectComps', () => {
  it('keeps a comparable that satisfies every rule', () => {
    const r = selectComps([comp()], SUBJECT, DEFAULT_CRITERIA, AS_OF);
    expect(r.counts).toEqual({ returned: 1, qualified: 1, shown: 1 });
    expect(r.decisions[0].displayPosition).toBe(1);
    expect(r.decisions[0].exclusionReason).toBeNull();
  });

  describe('each rule excludes, with a reason', () => {
    it.each<[string, Partial<CompCandidate>, string]>([
      ['no sale price', { salePrice: null }, 'no_sale_price'],
      ['zero sale price', { salePrice: 0 }, 'no_sale_price'],
      ['different use code', { useCodeDescription: 'Duplex' }, 'use_code'],
      ['sale older than the window', { recordingDate: '2024-01-01' }, 'sale_too_old'],
      ['no recording date', { recordingDate: null }, 'sale_too_old'],
      ['beyond the radius', { proximityMiles: 1.4 }, 'outside_radius'],
      ['no proximity', { proximityMiles: null }, 'outside_radius'],
      ['living area too large', { buildingArea: 10912 }, 'living_area'],
      ['living area too small', { buildingArea: 736 }, 'living_area'],
      ['too many bedrooms', { bedrooms: 24 }, 'bedrooms'],
      ['too few bathrooms', { baths: 4 }, 'bathrooms'],
    ])('%s -> %s', (_label, over, reason) => {
      const r = selectComps([comp(over)], SUBJECT, DEFAULT_CRITERIA, AS_OF);
      expect(r.decisions[0].selected).toBe(false);
      expect(r.decisions[0].exclusionReason).toBe(reason);
      expect(r.counts.shown).toBe(0);
    });
  });

  /**
   * The pathology from the real payload: a 10,912 sf 24-bedroom building was
   * offered as comparable to a 1,487 sf three-bed house. Both rules catch it;
   * the reported reason must be the first that failed, deterministically.
   */
  it('rejects the real-world outlier and names the FIRST failing rule', () => {
    const r = selectComps(
      [comp({ buildingArea: 10912, bedrooms: 24, proximityMiles: 0.33 })],
      SUBJECT, DEFAULT_CRITERIA, AS_OF,
    );
    expect(r.decisions[0].exclusionReason).toBe('living_area');
  });

  describe('never pads to reach the target', () => {
    it('shows seven when only seven qualify, target twelve', () => {
      const good = Array.from({ length: 7 }, () => comp());
      const bad = Array.from({ length: 16 }, () => comp({ buildingArea: 9000 }));
      const r = selectComps([...good, ...bad], SUBJECT, DEFAULT_CRITERIA, AS_OF);
      expect(r.criteria.maxComps).toBe(12);
      expect(r.counts).toEqual({ returned: 23, qualified: 7, shown: 7 });
    });

    it('shows zero rather than loosening when nothing qualifies', () => {
      const r = selectComps(
        Array.from({ length: 23 }, () => comp({ useCodeDescription: 'Commercial' })),
        SUBJECT, DEFAULT_CRITERIA, AS_OF,
      );
      expect(r.counts).toEqual({ returned: 23, qualified: 0, shown: 0 });
      expect(r.selected).toEqual([]);
    });

    it('caps at the target and marks the overflow rather than dropping it silently', () => {
      const r = selectComps(Array.from({ length: 20 }, () => comp()), SUBJECT, DEFAULT_CRITERIA, AS_OF);
      expect(r.counts.qualified).toBe(20);
      expect(r.counts.shown).toBe(12);
      const over = r.decisions.filter((d) => d.exclusionReason === 'over_max');
      expect(over).toHaveLength(8);
      // every returned comp is still accounted for
      expect(r.decisions).toHaveLength(20);
    });
  });

  it('returns the criteria it was GIVEN, never values derived from results', () => {
    // Furthest selected comp is 0.2 mi, but the criterion was 1 mile.
    const r = selectComps([comp({ proximityMiles: 0.2 })], SUBJECT, DEFAULT_CRITERIA, AS_OF);
    expect(r.criteria.radiusMiles).toBe(1);
    expect(r.criteria).toEqual(DEFAULT_CRITERIA);
  });

  /**
   * Two orderings, deliberately different, and both matter:
   *   - `selected` is DISPLAY order (nearest first) — tables, charts and the
   *     map all iterate this, so they cannot disagree with each other.
   *   - `decisions` stays in SOURCE order, so the set SiteX returned can be
   *     reconstructed exactly as received.
   */
  it('orders selected comps nearest first, so table and map agree', () => {
    const r = selectComps(
      [comp({ proximityMiles: 0.9 }), comp({ proximityMiles: 0.1 }), comp({ proximityMiles: 0.5 })],
      SUBJECT, DEFAULT_CRITERIA, AS_OF,
    );
    expect(r.selected.map((c) => c.proximityMiles)).toEqual([0.1, 0.5, 0.9]);
  });

  it('keeps decisions in SOURCE order so the returned set is reconstructable', () => {
    const r = selectComps(
      [comp({ proximityMiles: 0.9 }), comp({ proximityMiles: 0.1 }), comp({ proximityMiles: 0.5 })],
      SUBJECT, DEFAULT_CRITERIA, AS_OF,
    );
    expect(r.decisions.map((d) => d.candidate.proximityMiles)).toEqual([0.9, 0.1, 0.5]);
    // ...while displayPosition still ranks them by distance.
    expect(r.decisions.map((d) => d.displayPosition)).toEqual([3, 1, 2]);
  });

  it('displayPosition agrees with the order of `selected`', () => {
    const r = selectComps(
      [comp({ proximityMiles: 0.9 }), comp({ proximityMiles: 0.1 }), comp({ proximityMiles: 0.5 })],
      SUBJECT, DEFAULT_CRITERIA, AS_OF,
    );
    r.selected.forEach((c, i) => {
      const d = r.decisions.find((x) => x.candidate.sourcePosition === c.sourcePosition)!;
      expect(d.displayPosition).toBe(i + 1);
    });
  });

  it('every returned comp lands in exactly one state', () => {
    const r = selectComps(
      [comp(), comp({ salePrice: null }), comp({ bedrooms: 24 }), comp()],
      SUBJECT, DEFAULT_CRITERIA, AS_OF,
    );
    for (const d of r.decisions) {
      expect(d.selected ? d.exclusionReason === null : d.exclusionReason !== null).toBe(true);
      expect(d.selected ? d.displayPosition !== null : d.displayPosition === null).toBe(true);
    }
    expect(r.decisions).toHaveLength(r.counts.returned);
  });

  describe('criteria are configurable, for the slider', () => {
    it('a looser living-area tolerance admits what the default rejects', () => {
      const wide: CompCriteria = { ...DEFAULT_CRITERIA, livingAreaPct: 90 };
      const c = comp({ buildingArea: 2800 });
      expect(selectComps([c], SUBJECT, DEFAULT_CRITERIA, AS_OF).counts.shown).toBe(0);
      expect(selectComps([c], SUBJECT, wide, AS_OF).counts.shown).toBe(1);
    });

    it('a null tolerance disables that rule entirely', () => {
      const off: CompCriteria = { ...DEFAULT_CRITERIA, livingAreaPct: null, bedDelta: null };
      const r = selectComps([comp({ buildingArea: 10912, bedrooms: 24 })], SUBJECT, off, AS_OF);
      expect(r.counts.shown).toBe(1);
    });

    it('sameUseCode=false stops comparing use codes', () => {
      const off: CompCriteria = { ...DEFAULT_CRITERIA, sameUseCode: false };
      expect(selectComps([comp({ useCodeDescription: 'Duplex' })], SUBJECT, off, AS_OF).counts.shown).toBe(1);
    });
  });

  it('a sale dated in the future is excluded, not treated as recent', () => {
    const r = selectComps([comp({ recordingDate: '2027-01-01' })], SUBJECT, DEFAULT_CRITERIA, AS_OF);
    expect(r.decisions[0].exclusionReason).toBe('sale_too_old');
  });

  it('skips a rule when the subject lacks the attribute to compare against', () => {
    const noArea: SubjectFacts = { ...SUBJECT, buildingArea: null };
    const r = selectComps([comp({ buildingArea: 99_999 })], noArea, DEFAULT_CRITERIA, AS_OF);
    expect(r.counts.shown).toBe(1);
  });

  it('handles an empty returned set without inventing anything', () => {
    const r = selectComps([], SUBJECT, DEFAULT_CRITERIA, AS_OF);
    expect(r.counts).toEqual({ returned: 0, qualified: 0, shown: 0 });
    expect(r.selected).toEqual([]);
  });
});
