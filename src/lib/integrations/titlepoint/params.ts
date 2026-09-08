import type { TitlePointCreateInput, TitlePointSearchType } from './types';

export const SERVICE_TYPE_MAP: Record<TitlePointSearchType, string> = {
  geo_address: 'TitlePoint.Geo.Address',
  tax: 'TitlePoint.Geo.Tax',
  legal_vesting: 'TitlePoint.LegalAndVesting2',
  grant_deed: 'TitlePoint.Geo.Address',
};

export function buildLegacyGeoParameters(address: string): string {
  return [
    `Address.FullAddress=${address}`,
    'General.AutoSearchTaxes=False',
    'Tax.CurrentYearTaxesOnly=False',
    'General.AutoSearchProperty=True',
    'General.AutoSearchOwnerNames=False',
    'General.AutoSearchStarters=False',
    'Property.IntelligentPropertyGrouping=true',
  ].join(';') + ';';
}

export function buildLegacyTaxParameters(apn?: string): string {
  return `Tax.APN=${apn ?? ''};General.AutoSearchTaxes=true;General.AutoSearchProperty=false`;
}

/**
 * The unit, formatted for `LvLookupValue`.
 *
 * `buildLegacyLvParameters` interpolates it as `${address}, ${unitInfo}${city}`,
 * so it carries its own trailing separator, and an empty unit must produce an
 * empty string rather than a stray space that would alter the lookup value on
 * every non-condo order.
 *
 * THE VALUE IS PASSED THROUGH UNCHANGED, BECAUSE THAT IS WHAT LEGACY DOES.
 * Legacy hands the raw unit straight to `createService4` with no prefix. An
 * earlier version of this function added `#` to a bare number, which was an
 * invention — a format nothing had ever sent TitlePoint. Matching legacy is
 * not the same as being confirmed with the vendor, and it is not claimed to
 * be: it is the only format with a working precedent.
 *
 * That the legal-vesting search needs the unit at all IS established — without
 * it the search resolves to the building, and 16281 Castello Ln is at least
 * six parcels sharing one address.
 */
export function lvUnitInfo(unitNumber: string | null | undefined): string | undefined {
  const n = (unitNumber ?? '').trim();
  if (!n) return undefined;
  return `${n} `;
}

export function buildLegacyLvParameters(input: {
  address: string;
  city: string;
  apn?: string;
  unitInfo?: string;
  includeAddressApn: boolean;
}): string {
  const lvLookupValue = `${input.address}, ${input.unitInfo ?? ''}${input.city}`;
  const parts = input.includeAddressApn
    ? [
        `Address1=${input.address}`,
        `City=${input.city}`,
        `Pin=${input.apn ?? ''}`,
        'LvLookup=Address',
        `LvLookupValue=${lvLookupValue}`,
        'LvReportFormat=LV',
        'IncludeTaxAssessor=true',
      ]
    : [
        `Pin=${input.apn ?? ''}`,
        'LvLookup=Address',
        `LvLookupValue=${lvLookupValue}`,
        'LvReportFormat=LV',
        'IncludeTaxAssessor=true',
      ];

  return parts.join(';');
}

export function buildLegacyGrantDeedParameters(fips: string, year: string, instrumentDocId: string): string {
  return `FIPS=${fips},TYPE=REC,SUBTYPE=ALL,YEAR=${year},INST=${instrumentDocId}`;
}

export function buildLegacyCreateServiceParameters(
  input: TitlePointCreateInput,
  options?: { includeLvAddressApn?: boolean; unitInfo?: string }
): string {
  switch (input.searchType) {
    case 'tax':
      return buildLegacyTaxParameters(input.apn);
    case 'legal_vesting':
      return buildLegacyLvParameters({
        address: input.address,
        city: input.city,
        apn: input.apn,
        unitInfo: options?.unitInfo,
        includeAddressApn: options?.includeLvAddressApn ?? true,
      });
    default:
      return buildLegacyGeoParameters(input.address);
  }
}
