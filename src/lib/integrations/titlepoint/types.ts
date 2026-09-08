// ─── Search Types ───────────────────────────────────────────────────────────

export type TitlePointSearchType = 'geo_address' | 'legal_vesting' | 'grant_deed' | 'tax';

// ─── API Responses ──────────────────────────────────────────────────────────

export interface TitlePointCreateResponse {
  requestId: string;
  orderId: string;
  returnStatus: string;
}

export interface TitlePointSummaryResponse {
  status: 'pending' | 'success' | 'failed';
  serviceIds: string[];
  resultIds: string[];
  message?: string;
}

export interface TitlePointResultResponse {
  serviceId: string;
  data: Record<string, unknown>;
  returnStatus: string;
}

export interface TitlePointImageResponse {
  base64Data: string;
  status: string;
  returnStatus: string;
}

export interface TitlePointDocumentResponse {
  base64Data: string;
  returnStatus: string;
}

// ─── Create Service Input ───────────────────────────────────────────────────

export interface TitlePointCreateInput {
  address: string;
  city: string;
  state: string;
  county?: string;
  fips?: string;
  apn?: string;
  /**
   * The unit, for a condo or any address with one.
   *
   * `buildLegacyLvParameters` has always had a slot for this and nothing ever
   * filled it, so the legal-vesting search ran on the building. On a condo that
   * returns the building's legal description rather than the unit's — wrong on
   * a prelim, and invisible, because nothing about it looks like an error.
   */
  unitNumber?: string | null;
  searchType: TitlePointSearchType;
}
