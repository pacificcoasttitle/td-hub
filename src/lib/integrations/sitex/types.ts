/**
 * SiteX (BKI) property lookup types.
 * See docs/cannon/SiteX-and-TitlePoint-Complete-Reference.md for the full spec.
 */

// ─── Normalized Result ──────────────────────────────────────────────────────

export interface SiteXPropertyData {
  matchCode: 'S' | 'M' | 'N';
  apn: string | null;
  legalDescription: string | null;
  county: string | null;
  propertyType: string | null;
  primaryOwner: string | null;
  secondaryOwner: string | null;
  fullAddress: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  unitNumber: string | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  lotSize: number | null;
  yearBuilt: number | null;
  assessedValue: number | null;
  lastSaleDate: string | null;
  lastSalePrice: number | null;
}

// ─── Raw API Response ───────────────────────────────────────────────────────
// Field names come from BKI's actual response. The property data lives at
// Feed.PropertyProfile — NOT at the response root.

export interface SiteXSearchResponse {
  MatchCode: string;
  Feed?: {
    PropertyProfile?: SiteXRawPropertyProfile;
  };
  Locations?: SiteXRawLocation[];
}

export interface SiteXRawPropertyProfile {
  APN?: string;
  LegalBriefDescription?: string;
  County?: string;
  PropertyType?: string;
  OwnerName1?: string;
  OwnerName2?: string;
  FullAddress?: string;
  Address?: string;
  City?: string;
  State?: string;
  Zip?: string;
  UnitNumber?: string;
  Bedrooms?: string | number;
  Bathrooms?: string | number;
  SquareFootage?: string | number;
  LotSize?: string | number;
  YearBuilt?: string | number;
  AssessedValue?: string | number;
  LastSaleDate?: string;
  LastSalePrice?: string | number;
  [key: string]: unknown;
}

export interface SiteXRawLocation {
  Address?: string;
  City?: string;
  State?: string;
  Zip?: string;
  APN?: string;
  [key: string]: unknown;
}

// ─── Token Response ─────────────────────────────────────────────────────────

export interface SiteXTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

// ─── Lookup Params ──────────────────────────────────────────────────────────

export interface PropertyLookupParams {
  street: string;
  city: string;
  state: string;
  zip: string;
}

export interface ApnLookupParams {
  apn: string;
  county: string;
  state?: string;
}
