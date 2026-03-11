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

// ─── Create Service Input ───────────────────────────────────────────────────

export interface TitlePointCreateInput {
  address: string;
  city: string;
  state: string;
  county?: string;
  fips?: string;
  searchType: TitlePointSearchType;
}
