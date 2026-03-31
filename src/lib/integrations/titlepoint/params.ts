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
