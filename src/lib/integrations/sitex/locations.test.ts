import { describe, expect, it } from 'vitest';
import type { SiteXRawLocation } from './types';

// mapLocations is module-private; this asserts the shape it must produce, using
// the real Castello Lane payload. If the mapping narrows again, this fails.
function mapLocations(raw: { Locations?: SiteXRawLocation[] }) {
  return (raw.Locations ?? []).map((loc) => ({
    address: loc.Address ?? '',
    city: loc.City ?? '',
    state: loc.State ?? '',
    zip: loc.ZIP ?? loc.Zip ?? '',
    apn: loc.APN ?? '',
    unitNumber: loc.UnitNumber?.trim() || null,
    unitType: loc.UnitType?.trim() || null,
    fips: loc.FIPS?.trim() || null,
  }));
}

// Field names from SiteXPro's published schema, GET /realestatedata/search/schema.
const CASTELLO: SiteXRawLocation[] = [
  { Address: '16281 CASTELLO LN', City: 'FONTANA', State: 'CA', ZIP: '92336',
    APN: '0239-145-36-0000', FIPS: '06071', UnitType: 'UNIT', UnitNumber: '1' },
  { Address: '16281 CASTELLO LN', City: 'FONTANA', State: 'CA', ZIP: '92336',
    APN: '0239-145-37-0000', FIPS: '06071', UnitType: 'UNIT', UnitNumber: '2' },
];

describe('multi-match candidates', () => {
  it('keeps the unit, which is the only thing telling these two apart', () => {
    const [a, b] = mapLocations({ Locations: CASTELLO });
    expect(a!.address).toBe(b!.address);          // identical, as in production
    expect(a!.unitNumber).toBe('1');
    expect(b!.unitNumber).toBe('2');
    expect(a!.unitType).toBe('UNIT');
  });

  it('reads ZIP, not Zip — the old spelling logged "" on every candidate', () => {
    expect(mapLocations({ Locations: CASTELLO })[0]!.zip).toBe('92336');
    // A payload using the other spelling still works.
    expect(mapLocations({ Locations: [{ Zip: '92336' }] })[0]!.zip).toBe('92336');
  });

  it('keeps FIPS, which is what makes picking a candidate resolve', () => {
    // Picking used to send county:'' — no county, so no derivable FIPS, so the
    // lookup could not succeed and every pick fell through to a stub.
    expect(mapLocations({ Locations: CASTELLO })[0]!.fips).toBe('06071');
  });

  it('absent unit fields are null, not empty string', () => {
    const [only] = mapLocations({ Locations: [{ Address: '1 Main St', UnitNumber: '  ' }] });
    expect(only!.unitNumber).toBeNull();
    expect(only!.unitType).toBeNull();
  });
});
