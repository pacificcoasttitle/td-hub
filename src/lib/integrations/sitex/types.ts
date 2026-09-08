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
  fips: string | null;
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

/**
 * One multi-match candidate.
 *
 * Field names are from SiteXPro's own OpenAPI document, free at
 * `GET /realestatedata/search/schema/{feedId}`:
 *
 *   FIPS, APN, Address, City, State, ZIP, ZIP4, UnitType, UnitNumber,
 *   Latitude, Longitude, UseCode, UseCodeDescription
 *
 * Two things follow that were wrong before:
 *
 *  - The zip is `ZIP`, not `Zip`. We read `Zip`, got undefined, and every
 *    logged candidate carried `"zip": ""` — visible in the Castello Lane and
 *    Lake Arrowhead responses and never questioned.
 *  - `UnitNumber` and `UnitType` exist on every candidate. Dropping them is
 *    what made 16281 Castello Ln return six rows reading `16281 CASTELLO LN`
 *    with nothing to tell them apart.
 *
 * `Zip` is kept as a fallback rather than removed: it costs nothing, and this
 * type is a guess about a vendor payload until a response proves otherwise.
 */
export interface SiteXRawLocation {
  Address?: string;
  City?: string;
  State?: string;
  ZIP?: string;
  ZIP4?: string;
  /** Non-schema spelling, retained as a fallback. */
  Zip?: string;
  APN?: string;
  FIPS?: string;
  UnitType?: string;
  UnitNumber?: string;
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
  /** Used only to derive `fips`. SiteX's /search takes no county parameter. */
  county: string;
  state?: string;
  /** A stored 5-digit SiteX FIPS, preferred over deriving one from the county. */
  fips?: string | null;
}
