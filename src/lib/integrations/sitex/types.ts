/**
 * SiteX (BKI) property lookup types.
 * See docs/cannon/SiteX-and-TitlePoint-Complete-Reference.md for the full spec.
 */

// ─── Normalized Result ──────────────────────────────────────────────────────

import type { OwnerKind } from '@/lib/domain/orders/names/sitex-owner-names';

export interface SiteXPropertyData {
  matchCode: 'S' | 'M' | 'N';
  apn: string | null;
  legalDescription: string | null;
  county: string | null;
  fips: string | null;
  propertyType: string | null;
  primaryOwner: string | null;
  secondaryOwner: string | null;
  /**
   * Whether the current owner is a person or an organization, per SiteX's own
   * current-owner deed. 'unknown' when no such deed came back — a normal
   * outcome, not a failure.
   *
   * OPTIONAL on purpose. A SiteXPropertyData can also be rebuilt from a
   * client-supplied siteXSnapshot on the create path, which carries no
   * TransferHistory and therefore cannot know this. Absent and 'unknown' mean
   * the same thing to every consumer, so callers read it as
   * `ownerKind ?? 'unknown'` rather than being forced to invent a value.
   */
  ownerKind?: OwnerKind;
  /** Corroboration only: LC, CO, HW, SM... See owner-kind.ts for why it is not the discriminator. */
  ownerEntityCode?: string | null;
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
    /**
     * Deed / mortgage / foreclosure history. Discarded until now, and the only
     * place SiteX says whether the current owner is a person or an
     * organization — see integrations/sitex/owner-kind.ts. Left as unknown
     * because the shape is deep, optional at every level, and only one
     * consumer reads it.
     */
    TransferHistory?: unknown;
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
