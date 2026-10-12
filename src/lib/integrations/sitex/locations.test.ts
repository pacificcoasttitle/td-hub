import { describe, expect, it } from 'vitest';
import { mapLocations } from './client';
import type { SiteXRawLocation } from './types';

// ─── The real function, not a copy of it ────────────────────────────────────
//
// This file used to declare its own mapLocations, because the real one was
// module-private, with a comment saying "if the mapping narrows again, this
// fails". It would not have. The copy drifted the moment the real mapping
// gained a field, and a guard over a reimplementation of the thing it guards
// passes for the wrong reason by construction — EVIDENCE_RULES rule 1, which
// this repo learned on 262 assertions against the source text of a file that
// was not the one rendering.
//
// mapLocations is exported now, so the copy is gone.

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

  it('keeps the owner and the use description, which is what makes a condo list choosable', () => {
    // From the real 300 for 4572 W 5th St, Santa Ana. Every candidate at a
    // condominium shares the street line; the owner is the field an operator
    // recognises, and both of these were being dropped.
    const [only] = mapLocations({
      Locations: [{
        Address: '4572 W 5TH ST', City: 'SANTA ANA', State: 'CA', ZIP: '92703',
        APN: '936-640-31', FIPS: '06059', UnitType: '#', UnitNumber: '31',
        UseCode: '1004', UseCodeDescription: 'Condominium Unit (Residential)',
        Owner: 'DIAZ, OMAR',
      }],
    });
    expect(only!.owner).toBe('DIAZ, OMAR');
    expect(only!.useCodeDescription).toBe('Condominium Unit (Residential)');
  });

  it('is null for both when SiteX sends neither — the schema does not promise Owner', () => {
    const [only] = mapLocations({ Locations: [{ Address: '1 Main St' }] });
    expect(only!.owner).toBeNull();
    expect(only!.useCodeDescription).toBeNull();
  });
});
