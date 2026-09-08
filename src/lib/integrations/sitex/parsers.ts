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
  const owners = splitOwners(profile.PrimaryOwnerName);

  return {
    apn: profile.APN ?? null,
    legalDescription: profile.LegalDescriptionInfo?.LegalBriefDescription ?? null,
    county: profile.CountyName ?? null,
    fips: profile.FIPS ?? null,
    propertyType: profile.PropertyCharacteristics?.UseCodeDescription ?? null,
    primaryOwner: owners.primary,
    secondaryOwner: owners.secondary,
    fullAddress: profile.SiteAddress ?? null,
    city: profile.SiteCity ?? null,
    state: profile.SiteState ?? null,
    zip: profile.SiteZip ?? null,
    unitNumber: profile.SiteUnit ?? null,
    beds: toNum(profile.PropertyCharacteristics?.Bedrooms),
    baths: toNum(profile.PropertyCharacteristics?.Baths),
    sqft: toNum(profile.PropertyCharacteristics?.BuildingArea),
    lotSize: toNum(profile.PropertyCharacteristics?.LotSize),
    yearBuilt: toNum(profile.PropertyCharacteristics?.YearBuilt),
    assessedValue: toNum(profile.AssessmentTaxInfo?.AssessedValue),
    lastSaleDate: profile.SaleLoanInfo?.TransferDate ?? null,
    lastSalePrice: toNum(profile.SaleLoanInfo?.SalesPrice),
  };
}

function splitOwners(raw: string | undefined): { primary: string | null; secondary: string | null } {
  if (!raw) return { primary: null, secondary: null };
  const parts = raw.split(';').map(s => s.trim()).filter(Boolean);
  return { primary: parts[0] ?? null, secondary: parts[1] ?? null };
}

export function emptyResult(matchCode: 'M' | 'N'): SiteXPropertyData {
  return {
    matchCode, apn: null, legalDescription: null, county: null, fips: null,
    propertyType: null, primaryOwner: null, secondaryOwner: null,
    fullAddress: null, city: null, state: null, zip: null, unitNumber: null,
    beds: null, baths: null, sqft: null, lotSize: null,
    yearBuilt: null, assessedValue: null, lastSaleDate: null, lastSalePrice: null,
  };
}


export interface PropertySearchResult {
  match: 'single' | 'multi' | 'none';
  property: SiteXPropertyData | null;
  locations: Array<{
    address: string;
    city: string;
    state: string;
    zip: string;
    apn: string;
    /** From SiteX's Location.UnitNumber — the only thing distinguishing units in one building. */
    unitNumber: string | null;
    /** Location.UnitType, e.g. "APT", "UNIT". Shown beside the number when present. */
    unitType: string | null;
    /** Location.FIPS — authoritative for this parcel, better than deriving from a county name. */
    fips: string | null;
  }>;
}
