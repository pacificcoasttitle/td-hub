import { VendorResult, vendorSuccess, vendorError } from '../types';
import { db } from '@/lib/db/client';
import { vendorApiLogs } from '@/lib/db/schema';
import type {
  SiteXPropertyData,
  SiteXSearchResponse,
  SiteXTokenResponse,
  SiteXRawPropertyProfile,
  PropertyLookupParams,
  ApnLookupParams,
} from './types';

const VENDOR = 'sitex';
const TOKEN_BUFFER_MS = 60_000;
const TIMEOUT_MS = 30_000;

// ─── Config ─────────────────────────────────────────────────────────────────

function getConfig() {
  const baseUrl = process.env.SITEX_BASE_URL;
  if (!baseUrl) return null;
  return {
    baseUrl: baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl,
    clientId: process.env.SITEX_CLIENT_ID ?? '',
    clientSecret: process.env.SITEX_CLIENT_SECRET ?? '',
    feedId: process.env.SITEX_FEED_ID ?? '',
  };
}

// ─── Token Cache ────────────────────────────────────────────────────────────

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(baseUrl: string, clientId: string, clientSecret: string): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }

  const tokenUrl = `${baseUrl}/ls/apigwy/oauth2/v1/token`;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`Token request failed: HTTP ${response.status}`);
  }

  const data = (await response.json()) as SiteXTokenResponse;

  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in * 1000) - TOKEN_BUFFER_MS,
  };

  return cachedToken.token;
}

// ─── Logging ────────────────────────────────────────────────────────────────

async function logRequest(params: {
  operation: string;
  requestId: string;
  startedAt: Date;
  success: boolean;
  errorCategory?: string;
  requestMeta?: Record<string, unknown>;
  responseMeta?: Record<string, unknown>;
}) {
  try {
    await db.insert(vendorApiLogs).values({
      vendor: VENDOR,
      operation: params.operation,
      requestId: params.requestId,
      startedAt: params.startedAt,
      endedAt: new Date(),
      success: params.success,
      errorCategory: params.errorCategory ?? null,
      requestMeta: params.requestMeta ?? null,
      responseMeta: params.responseMeta ?? null,
    });
  } catch { /* Don't let logging failures break the main flow */ }
}

// ─── Response Mapping ───────────────────────────────────────────────────────

function toNum(val: string | number | undefined): number | null {
  if (val === undefined || val === null || val === '') return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
}

function truncateZip(zip: string | undefined): string {
  if (!zip) return '';
  return zip.replace(/-.*$/, '').slice(0, 5);
}

function mapProfile(profile: SiteXRawPropertyProfile): Omit<SiteXPropertyData, 'matchCode'> {
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

function emptyResult(matchCode: 'M' | 'N'): SiteXPropertyData {
  return {
    matchCode, apn: null, legalDescription: null, county: null,
    propertyType: null, primaryOwner: null, secondaryOwner: null,
    fullAddress: null, city: null, state: null, zip: null, unitNumber: null,
    beds: null, baths: null, sqft: null, lotSize: null,
    yearBuilt: null, assessedValue: null, lastSaleDate: null, lastSalePrice: null,
  };
}

// ─── Mock ───────────────────────────────────────────────────────────────────

const MOCK_PROPERTY: SiteXPropertyData = {
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

// ─── Search Result (includes multi-match locations) ─────────────────────────

export interface PropertySearchResult {
  match: 'single' | 'multi' | 'none';
  property: SiteXPropertyData | null;
  locations: Array<{ address: string; city: string; state: string; zip: string; apn: string }>;
}

export async function propertySearch(
  params: PropertyLookupParams
): Promise<VendorResult<PropertySearchResult>> {
  const requestId = crypto.randomUUID();
  const startedAt = new Date();
  const config = getConfig();

  if (!config) {
    await logRequest({
      operation: 'property_search_mock', requestId, startedAt, success: true,
      requestMeta: { ...params, mock: true },
    });
    return vendorSuccess<PropertySearchResult>({
      match: 'single',
      property: MOCK_PROPERTY,
      locations: [],
    }, { requestId, durationMs: 0 });
  }

  const zip5 = truncateZip(params.zip);
  const lastLine = `${params.city}, ${params.state}, ${zip5}`;
  const searchUrl = new URL(`${config.baseUrl}/realestatedata/search`);
  searchUrl.searchParams.set('addr', params.street);
  searchUrl.searchParams.set('lastLine', lastLine);
  searchUrl.searchParams.set('feedId', config.feedId);

  try {
    const token = await getAccessToken(config.baseUrl, config.clientId, config.clientSecret);

    const response = await fetch(searchUrl.toString(), {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const durationMs = Date.now() - startedAt.getTime();

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      await logRequest({
        operation: 'property_search', requestId, startedAt, success: false,
        errorCategory: 'API_ERROR',
        requestMeta: { addr: params.street, lastLine },
        responseMeta: { status: response.status, body: errorBody.slice(0, 500) },
      });
      return vendorError<PropertySearchResult>(VENDOR, 'SEARCH_FAILED', `SiteX ${response.status}`, {
        httpStatus: response.status, retryable: response.status >= 500, requestId, durationMs,
      });
    }

    const raw = (await response.json()) as SiteXSearchResponse;
    const matchCode = (raw.MatchCode ?? 'N').toUpperCase();

    let result: PropertySearchResult;

    if (matchCode === 'S' && raw.Feed?.PropertyProfile) {
      const mapped = { matchCode: 'S' as const, ...mapProfile(raw.Feed.PropertyProfile) };
      result = { match: 'single', property: mapped, locations: [] };
    } else if (matchCode === 'M' && raw.Locations) {
      result = {
        match: 'multi',
        property: null,
        locations: raw.Locations.map((loc) => ({
          address: loc.Address ?? '',
          city: loc.City ?? '',
          state: loc.State ?? '',
          zip: loc.Zip ?? '',
          apn: loc.APN ?? '',
        })),
      };
    } else {
      result = { match: 'none', property: null, locations: [] };
    }

    await logRequest({
      operation: 'property_search', requestId, startedAt, success: true,
      requestMeta: { addr: params.street, lastLine },
      responseMeta: { match: result.match, locationCount: result.locations.length },
    });

    return vendorSuccess(result, { requestId, durationMs });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const durationMs = Date.now() - startedAt.getTime();

    await logRequest({
      operation: 'property_search', requestId, startedAt, success: false,
      errorCategory: 'NETWORK',
      requestMeta: { addr: params.street, lastLine },
      responseMeta: { error: message },
    });

    return vendorError<PropertySearchResult>(VENDOR, 'NETWORK_ERROR', message, {
      retryable: true, requestId, durationMs,
    });
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

export async function propertyLookup(
  params: PropertyLookupParams
): Promise<VendorResult<SiteXPropertyData>> {
  const requestId = crypto.randomUUID();
  const startedAt = new Date();
  const config = getConfig();

  if (!config) {
    await logRequest({
      operation: 'property_lookup_mock',
      requestId, startedAt, success: true,
      requestMeta: { ...params, mock: true },
    });
    return vendorSuccess(MOCK_PROPERTY, { requestId, durationMs: 0 });
  }

  const zip5 = truncateZip(params.zip);
  const lastLine = `${params.city}, ${params.state}, ${zip5}`;
  const searchUrl = new URL(`${config.baseUrl}/realestatedata/search`);
  searchUrl.searchParams.set('addr', params.street);
  searchUrl.searchParams.set('lastLine', lastLine);
  searchUrl.searchParams.set('feedId', config.feedId);

  try {
    const token = await getAccessToken(config.baseUrl, config.clientId, config.clientSecret);

    const response = await fetch(searchUrl.toString(), {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const durationMs = Date.now() - startedAt.getTime();

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      await logRequest({
        operation: 'property_lookup', requestId, startedAt, success: false,
        errorCategory: 'API_ERROR',
        requestMeta: { addr: params.street, lastLine, feedId: config.feedId },
        responseMeta: { status: response.status, body: errorBody.slice(0, 500) },
      });
      return vendorError<SiteXPropertyData>(VENDOR, 'SEARCH_FAILED', `SiteX ${response.status}`, {
        httpStatus: response.status, retryable: response.status >= 500, requestId, durationMs,
      });
    }

    const raw = (await response.json()) as SiteXSearchResponse;
    const matchCode = (raw.MatchCode ?? 'N').toUpperCase();

    let result: SiteXPropertyData;

    if (matchCode === 'S' && raw.Feed?.PropertyProfile) {
      result = { matchCode: 'S', ...mapProfile(raw.Feed.PropertyProfile) };
    } else if (matchCode === 'M') {
      result = emptyResult('M');
    } else {
      result = emptyResult('N');
    }

    await logRequest({
      operation: 'property_lookup', requestId, startedAt, success: true,
      requestMeta: { addr: params.street, lastLine, feedId: config.feedId },
      responseMeta: { matchCode: result.matchCode, apn: result.apn },
    });

    return vendorSuccess(result, { requestId, durationMs });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const durationMs = Date.now() - startedAt.getTime();

    await logRequest({
      operation: 'property_lookup', requestId, startedAt, success: false,
      errorCategory: 'NETWORK',
      requestMeta: { addr: params.street, lastLine },
      responseMeta: { error: message },
    });

    return vendorError<SiteXPropertyData>(VENDOR, 'NETWORK_ERROR', message, {
      retryable: true, requestId, durationMs,
    });
  }
}

export async function apnLookup(
  params: ApnLookupParams
): Promise<VendorResult<SiteXPropertyData>> {
  const requestId = crypto.randomUUID();
  const startedAt = new Date();
  const config = getConfig();

  if (!config) {
    await logRequest({
      operation: 'apn_lookup_mock', requestId, startedAt, success: true,
      requestMeta: { ...params, mock: true },
    });
    return vendorSuccess(MOCK_PROPERTY, { requestId, durationMs: 0 });
  }

  const searchUrl = new URL(`${config.baseUrl}/realestatedata/search`);
  searchUrl.searchParams.set('apn', params.apn);
  searchUrl.searchParams.set('county', params.county);
  searchUrl.searchParams.set('state', params.state ?? 'CA');
  searchUrl.searchParams.set('feedId', config.feedId);

  try {
    const token = await getAccessToken(config.baseUrl, config.clientId, config.clientSecret);

    const response = await fetch(searchUrl.toString(), {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const durationMs = Date.now() - startedAt.getTime();

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      await logRequest({
        operation: 'apn_lookup', requestId, startedAt, success: false,
        errorCategory: 'API_ERROR',
        requestMeta: { apn: params.apn, county: params.county },
        responseMeta: { status: response.status, body: errorBody.slice(0, 500) },
      });
      return vendorError<SiteXPropertyData>(VENDOR, 'SEARCH_FAILED', `SiteX ${response.status}`, {
        httpStatus: response.status, retryable: response.status >= 500, requestId, durationMs,
      });
    }

    const raw = (await response.json()) as SiteXSearchResponse;
    const matchCode = (raw.MatchCode ?? 'N').toUpperCase();

    let result: SiteXPropertyData;

    if (matchCode === 'S' && raw.Feed?.PropertyProfile) {
      result = { matchCode: 'S', ...mapProfile(raw.Feed.PropertyProfile) };
    } else if (matchCode === 'M') {
      result = emptyResult('M');
    } else {
      result = emptyResult('N');
    }

    await logRequest({
      operation: 'apn_lookup', requestId, startedAt, success: true,
      requestMeta: { apn: params.apn, county: params.county },
      responseMeta: { matchCode: result.matchCode, apn: result.apn },
    });

    return vendorSuccess(result, { requestId, durationMs });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const durationMs = Date.now() - startedAt.getTime();

    await logRequest({
      operation: 'apn_lookup', requestId, startedAt, success: false,
      errorCategory: 'NETWORK',
      requestMeta: { apn: params.apn, county: params.county },
      responseMeta: { error: message },
    });

    return vendorError<SiteXPropertyData>(VENDOR, 'NETWORK_ERROR', message, {
      retryable: true, requestId, durationMs,
    });
  }
}

export { type SiteXPropertyData, type PropertyLookupParams, type ApnLookupParams } from './types';
