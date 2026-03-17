import type { SiteXPropertyData, SiteXRawPropertyProfile } from './types';

function toNum(val: string | number | undefined): number | null {
  if (val === undefined || val === null || val === '') return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
}

export function truncateZip(zip: string | undefined): string {
  if (!zip) return '';
  return zip.replace(/-.*$/, '').slice(0, 5);
}

export function mapProfile(profile: SiteXRawPropertyProfile): Omit<SiteXPropertyData, 'matchCode'> {
  return {
    apn: profile.APN ?? null,
    legalDescription: profile.LegalBriefDescription ?? null,
    county: profile.County ?? null,
    propertyType: profile.PropertyType ?? null,
    primaryOwner: profile.OwnerName1 ?? null,
    secondaryOwner: profile.OwnerName2 ?? null,
    fullAddress: profile.FullAddress ?? profile.Address ?? null,
    city: profile.City ?? null,
    state: profile.State ?? null,
    zip: profile.Zip ?? null,
    unitNumber: profile.UnitNumber ?? null,
    beds: toNum(profile.Bedrooms),
    baths: toNum(profile.Bathrooms),
    sqft: toNum(profile.SquareFootage),
    lotSize: toNum(profile.LotSize),
    yearBuilt: toNum(profile.YearBuilt),
    assessedValue: toNum(profile.AssessedValue),
    lastSaleDate: profile.LastSaleDate ?? null,
    lastSalePrice: toNum(profile.LastSalePrice),
  };
}

export function emptyResult(matchCode: 'M' | 'N'): SiteXPropertyData {
  return {
    matchCode, apn: null, legalDescription: null, county: null,
    propertyType: null, primaryOwner: null, secondaryOwner: null,
    fullAddress: null, city: null, state: null, zip: null, unitNumber: null,
    beds: null, baths: null, sqft: null, lotSize: null,
    yearBuilt: null, assessedValue: null, lastSaleDate: null, lastSalePrice: null,
  };
}

export const MOCK_PROPERTY: SiteXPropertyData = {
  matchCode: 'S',
  apn: '8321-027-034',
  legalDescription: 'LOT 34, TRACT 12345, PER MAP REC IN BK 100 PG 50',
  county: 'Los Angeles',
  propertyType: 'Single Family Residence',
  primaryOwner: 'Joel S Cruz Pablo',
  secondaryOwner: 'Maria Sebastian',
  fullAddress: '123 Main St, Glendale, CA 91203',
  city: 'Glendale', state: 'CA', zip: '91203', unitNumber: null,
  beds: 3, baths: 2, sqft: 1850, lotSize: 6500,
  yearBuilt: 1975, assessedValue: 485000,
  lastSaleDate: '2020-06-15', lastSalePrice: 625000,
};

export interface PropertySearchResult {
  match: 'single' | 'multi' | 'none';
  property: SiteXPropertyData | null;
  locations: Array<{ address: string; city: string; state: string; zip: string; apn: string }>;
}
