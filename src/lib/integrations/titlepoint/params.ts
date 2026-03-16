import type { TitlePointSearchType, TitlePointCreateInput } from './types';

export const SERVICE_TYPE_MAP: Record<TitlePointSearchType, string> = {
  geo_address: 'TitlePoint.Geo.Address',
  tax: 'TitlePoint.TaxSearch',
  legal_vesting: 'TitlePoint.LegalAndVesting2',
  grant_deed: 'TitlePoint.Geo.Address',
};

export function buildParameters(input: TitlePointCreateInput): string {
  switch (input.searchType) {
    case 'tax':
      return [
        `APN=${input.fips ?? ''}`,
        'Property.AutoSearchTaxes=True',
        'Property.AutoSearchProperty=True',
      ].join(';');
    case 'legal_vesting':
      return [
        input.fips ? `FIPS=${input.fips}` : '',
        `APN=${input.fips ?? ''}`,
        `Address1=${input.address}`,
        `City=${input.city}`,
      ].filter(Boolean).join(';');
    default:
      return [
        `Address.FullAddress=${input.address}`,
        'General.AutoSearchTaxes=False',
        'Tax.CurrentYearTaxesOnly=False',
        'General.AutoSearchProperty=True',
        'General.AutoSearchOwnerNames=False',
        'General.AutoSearchStarters=False',
        'Property.IntelligentPropertyGrouping=true',
      ].join(';') + ';';
  }
}
