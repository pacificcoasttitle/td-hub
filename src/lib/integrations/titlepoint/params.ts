import type { TitlePointSearchType, TitlePointCreateInput } from './types';

export const SERVICE_TYPE_MAP: Record<TitlePointSearchType, string> = {
  geo_address: 'TitlePoint.Geo.Address',
  tax: 'TitlePoint.TaxSearch',
  legal_vesting: 'TitlePoint.LegalAndVesting2',
  grant_deed: 'TitlePoint.Geo.Address',
};

/**
 * Build the `parameters` field for CreateService calls.
 * Each search type has a different parameter string format from the legacy system.
 *
 * Legacy sources:
 *   tax:           frontend/controllers/order/TitlePoint.php lines 54-63
 *   legal_vesting: frontend/controllers/order/TitlePoint.php lines 82-90
 *   geo_address:   libraries/order/Titlepoint.php lines 447-451
 */
export function buildParameters(input: TitlePointCreateInput): string {
  switch (input.searchType) {
    case 'tax':
      // Legacy: 'Tax.APN=' . $apn . ';General.AutoSearchTaxes=true;General.AutoSearchProperty=false'
      return `Tax.APN=${input.apn ?? ''};General.AutoSearchTaxes=true;General.AutoSearchProperty=false`;

    case 'legal_vesting':
      // Legacy (with enable_lv_with_address_apn=1):
      // 'Address1=' . $address . ';City=' . $city . ';Pin=' . $apn
      //   . ';LvLookup=Address;LvLookupValue=' . $address . ', ' . $city
      //   . ';LvReportFormat=LV;IncludeTaxAssessor=true'
      return [
        `Address1=${input.address}`,
        `City=${input.city}`,
        `Pin=${input.apn ?? ''}`,
        `LvLookup=Address`,
        `LvLookupValue=${input.address}, ${input.city}`,
        `LvReportFormat=LV`,
        `IncludeTaxAssessor=true`,
      ].join(';');

    default:
      // Legacy geo (without unit number):
      // 'Address.FullAddress=' . $property
      //   . ';General.AutoSearchTaxes=False;Tax.CurrentYearTaxesOnly=False'
      //   . ';General.AutoSearchProperty=True;General.AutoSearchOwnerNames=False'
      //   . ';General.AutoSearchStarters=False;Property.IntelligentPropertyGrouping=true;'
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

/**
 * Build the `parameters` field for GetDocumentsByParameters3 (Grant Deed).
 * Legacy: 'FIPS=' . $fips . ',TYPE=REC,SUBTYPE=ALL,YEAR=' . $year . ',INST=' . $docId
 * Note: comma-separated, NOT semicolon-separated.
 */
export function buildGrantDeedParameters(fips: string, year: string, instrumentDocId: string): string {
  return `FIPS=${fips},TYPE=REC,SUBTYPE=ALL,YEAR=${year},INST=${instrumentDocId}`;
}
