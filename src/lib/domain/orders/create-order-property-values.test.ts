import { describe, expect, it } from 'vitest';
import {
  buildOrderPropertyValues,
  propertyFromSoftProCreatePayload,
} from './create-order';

describe('buildOrderPropertyValues', () => {
  it('writes the same columns createLocalRecords writes', () => {
    const row = buildOrderPropertyValues(
      8145,
      {
        property: {
          address: '18556 Rex Ln',
          city: 'Redding',
          state: 'CA',
          zip: '96003-1234',
          unitNumber: '2',
        },
      },
      null,
      { apn: '074-070-012-000', legal: '', county: 'Shasta', fips: '06089' },
    );

    expect(row).toEqual({
      orderId: 8145,
      address: '18556 Rex Ln',
      city: 'Redding',
      state: 'CA',
      zip: '96003',
      county: 'Shasta',
      apn: '074-070-012-000',
      // The unit is now stored in its own column, not only folded into
      // fullAddress. The TitlePoint legal-vesting search needs it as a
      // separate value — concatenated into the address it cannot be used.
      unitNumber: '2',
      legalDescription: null,
      propertyType: null,
      primaryOwner: null,
      secondaryOwner: null,
      fips: '06089',
      fullAddress: '18556 Rex Ln 2, Redding, CA',
    });
  });
});

describe('propertyFromSoftProCreatePayload', () => {
  it('maps Country to county and Description to legal — the logged create shape', () => {
    const mapped = propertyFromSoftProCreatePayload({
      Address1: '15181 Jackson St',
      City: 'Midway City',
      State: 'CA',
      Zip: '92655',
      Country: 'Orange',
      APNNumberParcelID: '107-151-44',
      Description: 'N TR 627 BLK LOT 30',
      EscrowBriefLegal: 'N TR 627 BLK LOT 30',
    });

    expect(mapped.property).toMatchObject({
      address: '15181 Jackson St',
      city: 'Midway City',
      zip: '92655',
      county: 'Orange',
      apn: '107-151-44',
    });
    expect(mapped.enriched).toEqual({
      apn: '107-151-44',
      legal: 'N TR 627 BLK LOT 30',
      county: 'Orange',
      fips: '06059',
    });
  });

  it('refuses a payload that cannot build a property row', () => {
    expect(() => propertyFromSoftProCreatePayload({ Address1: 'x' })).toThrow(
      /missing address, city, or zip/,
    );
  });
});
