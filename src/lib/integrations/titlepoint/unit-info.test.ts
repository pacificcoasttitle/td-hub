import { describe, expect, it } from 'vitest';
import { lvUnitInfo, buildLegacyLvParameters } from './params';

// ─── The legal-vesting search has to name the unit ───────────────────────────
//
// 16281 Castello Ln, Fontana is at least six parcels sharing one address. A
// legal-vesting search that names only the address resolves to the building, so
// the legal description that comes back belongs to the building rather than the
// unit — wrong on a prelim, and it does not look like an error.

describe('lvUnitInfo', () => {
  it('is undefined when there is no unit, so nothing changes for a house', () => {
    for (const v of [null, undefined, '', '   ']) {
      expect(lvUnitInfo(v)).toBeUndefined();
    }
  });

  it('passes the value through as legacy does, adding no prefix', () => {
    // Legacy hands the raw unit to createService4. An earlier draft of this
    // added '#' to bare numbers — a format nothing had ever sent TitlePoint.
    expect(lvUnitInfo('5')).toBe('5 ');
    expect(lvUnitInfo('  12B ')).toBe('12B ');
    expect(lvUnitInfo('#5')).toBe('#5 ');
    expect(lvUnitInfo('APT 5')).toBe('APT 5 ');
  });

  it('keeps its own trailing separator', () => {
    // The template is `${address}, ${unitInfo}${city}` — without the trailing
    // space the unit would run into the city name.
    expect(lvUnitInfo('5')!.endsWith(' ')).toBe(true);
  });
});

describe('the unit reaches LvLookupValue', () => {
  const lookupValue = (p: string) =>
    p.split(';').find((x) => x.startsWith('LvLookupValue='))?.slice('LvLookupValue='.length);

  it('a house is unchanged — no stray separator', () => {
    const p = buildLegacyLvParameters({
      address: '2715 E Avenue J6', city: 'Lancaster', apn: '3150-058-003', includeAddressApn: true,
    });
    expect(lookupValue(p)).toBe('2715 E Avenue J6, Lancaster');
  });

  it('a condo names the unit between the address and the city', () => {
    const p = buildLegacyLvParameters({
      address: '16281 Castello Ln', city: 'Fontana', apn: '0239-145-36-0000',
      unitInfo: lvUnitInfo('5'), includeAddressApn: true,
    });
    expect(lookupValue(p)).toBe('16281 Castello Ln, 5 Fontana');
  });

  it('the address-only form carries it too', () => {
    const p = buildLegacyLvParameters({
      address: '16281 Castello Ln', city: 'Fontana',
      unitInfo: lvUnitInfo('APT 3'), includeAddressApn: false,
    });
    expect(lookupValue(p)).toBe('16281 Castello Ln, APT 3 Fontana');
  });
});
