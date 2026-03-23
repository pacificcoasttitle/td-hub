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
  PrimaryOwnerName?: string;
  CountyName?: string;
  FIPS?: string;

  SiteAddress?: string;
  SiteCity?: string;
  SiteState?: string;
  SiteZip?: string;
  SiteZip4?: string;
  SiteUnit?: string;
  SiteUnitType?: string;
  SiteAddressCityState?: string;

  LegalDescriptionInfo?: {
    LegalBriefDescription?: string;
    TractNumber?: string;
    LotNumber?: string;
    [key: string]: unknown;
  };

  PropertyCharacteristics?: {
    Bedrooms?: string | number;
    Baths?: string | number;
    BuildingArea?: string | number;
    LotSize?: string | number;
    LotSizeUnits?: string;
    YearBuilt?: string | number;
    UseCode?: string;
    UseCodeDescription?: string;
    [key: string]: unknown;
  };

  AssessmentTaxInfo?: {
    AssessedValue?: string | number;
    LandValue?: string | number;
    ImprovementValue?: string | number;
    TaxAmount?: string;
    [key: string]: unknown;
  };

  SaleLoanInfo?: {
    TransferDate?: string;
    SalesPrice?: string | number;
    SellerName?: string;
    LenderName?: string;
    [key: string]: unknown;
  };

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
