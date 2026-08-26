import type { SiteXPropertyData, SiteXRawPropertyProfile } from './types';
import type { OwnerKindEvidence } from './owner-kind';

/** Used when no response was parsed at all — no deed, so no answer. */
const UNKNOWN_OWNER: OwnerKindEvidence = {
  kind: 'unknown', lastOrCorporateName: null, entityCode: null,
  entityCodeDesc: null, reason: 'no-transfer-history',
};

function toNum(val: string | number | undefined): number | null {
  if (val === undefined || val === null || val === '') return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
}

export function truncateZip(zip: string | undefined): string {
  if (!zip) return '';
  return zip.replace(/-.*$/, '').slice(0, 5);
}

/**
 * `ownerKind` is derived from TransferHistory by owner-kind.ts, NOT from the
 * profile — PropertyProfile carries no owner-type field. It is threaded in
 * rather than computed here so mapProfile stays a pure projection of the
 * profile object it is handed.
 */
export function mapProfile(
  profile: SiteXRawPropertyProfile,
  ownerEvidence: OwnerKindEvidence = UNKNOWN_OWNER,
): Omit<SiteXPropertyData, 'matchCode'> {
  const owners = splitOwners(profile.PrimaryOwnerName);

  return {
    ownerKind: ownerEvidence.kind,
    ownerEntityCode: ownerEvidence.entityCode,
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
    ownerKind: 'unknown', ownerEntityCode: null,
    fullAddress: null, city: null, state: null, zip: null, unitNumber: null,
    beds: null, baths: null, sqft: null, lotSize: null,
    yearBuilt: null, assessedValue: null, lastSaleDate: null, lastSalePrice: null,
  };
}


export interface PropertySearchResult {
  match: 'single' | 'multi' | 'none';
  property: SiteXPropertyData | null;
  locations: Array<{ address: string; city: string; state: string; zip: string; apn: string }>;
}
