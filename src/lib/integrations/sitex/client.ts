import { vendorSuccess, vendorError } from '../types';
import type { VendorResult } from '../types';
import type { SiteXPropertyData, SiteXSearchResponse, PropertyLookupParams, ApnLookupParams } from './types';
import { VENDOR, TIMEOUT_MS, getConfig, getAccessToken, logRequest } from './auth';
import { truncateZip, mapProfile, emptyResult, MOCK_PROPERTY } from './parsers';
import type { PropertySearchResult } from './parsers';

function inferMatchCode(raw: SiteXSearchResponse): string {
  if (raw.MatchCode) return raw.MatchCode.toUpperCase();
  if (raw.Feed?.PropertyProfile) return 'S';
  if (raw.Locations && raw.Locations.length > 1) return 'M';
  if (raw.Locations && raw.Locations.length === 1) return 'S';
  return 'N';
}

/**
 * SiteX signals two ordinary search outcomes with non-2xx status codes:
 *
 *   404 + ERROR_MESSAGES[].ErrorMessageCategoryCode === 'NotFound'
 *        → no property at that address. A normal answer, not a failure.
 *   300 + Locations[]
 *        → several candidate properties matched. Also a normal answer, and the
 *          body carries usable FIPS / APN / address for each candidate.
 *
 * Treating either as an API error made SiteX look ~30% broken when its real
 * error rate was zero, and silently discarded every multi-match response.
 * See docs/sitex-and-jobs-page-review.md.
 */
export type NonOkOutcome =
  | { kind: 'no_match' }
  | { kind: 'multi_match'; raw: SiteXSearchResponse }
  | { kind: 'error'; body: string };

/** Pure classifier over an already-read body, so it can be unit tested. */
export function classifyNonOkBody(status: number, body: string): NonOkOutcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { kind: 'error', body };
  }

  if (status === 404 && isNotFoundPayload(parsed)) {
    return { kind: 'no_match' };
  }

  if (status === 300) {
    const raw = parsed as SiteXSearchResponse;
    if (Array.isArray(raw?.Locations) && raw.Locations.length > 0) {
      return { kind: 'multi_match', raw };
    }
  }

  // Anything else — 5xx, auth, an unexpected 404 shape — stays an error.
  return { kind: 'error', body };
}

function isNotFoundPayload(parsed: unknown): boolean {
  const messages = (parsed as { ERROR_MESSAGES?: unknown })?.ERROR_MESSAGES;
  if (!Array.isArray(messages)) return false;
  return messages.some((m) => {
    const category = (m as { ErrorMessageCategoryCode?: unknown })?.ErrorMessageCategoryCode;
    const code = (m as { ErrorMessageCode?: unknown })?.ErrorMessageCode;
    return category === 'NotFound' || (typeof code === 'string' && code.startsWith('SXP-NotFound'));
  });
}

/** Reads the body once and classifies it. */
async function classifyNonOk(response: Response): Promise<NonOkOutcome> {
  const body = await response.text().catch(() => '');
  return classifyNonOkBody(response.status, body);
}

function mapLocations(raw: SiteXSearchResponse) {
  return (raw.Locations ?? []).map((loc) => ({
    address: loc.Address ?? '',
    city: loc.City ?? '',
    state: loc.State ?? '',
    zip: loc.Zip ?? '',
    apn: loc.APN ?? '',
  }));
}

export async function propertySearch(
  params: PropertyLookupParams
): Promise<VendorResult<PropertySearchResult>> {
  const requestId = crypto.randomUUID();
  const startedAt = new Date();
  const config = getConfig();

  if (!config) {
    await logRequest({ operation: 'property_search_mock', requestId, startedAt, success: true, requestMeta: { ...params, mock: true } });
    return vendorSuccess<PropertySearchResult>({ match: 'single', property: MOCK_PROPERTY, locations: [] }, { requestId, durationMs: 0 });
  }

  const zip5 = truncateZip(params.zip);
  const lastLine = `${params.city}, ${params.state}, ${zip5}`;
  const searchUrl = new URL(`${config.baseUrl}/realestatedata/search`);
  searchUrl.searchParams.set('addr', params.street);
  searchUrl.searchParams.set('lastLine', lastLine);
  searchUrl.searchParams.set('feedId', config.feedId);

  try {
    const token = await getAccessToken(config.baseUrl, config.clientId, config.clientSecret);
    const response = await fetch(searchUrl.toString(), { method: 'GET', headers: { 'Authorization': `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const durationMs = Date.now() - startedAt.getTime();

    if (!response.ok) {
      const outcome = await classifyNonOk(response);

      if (outcome.kind === 'no_match') {
        await logRequest({ operation: 'property_search', requestId, startedAt, success: true, requestMeta: { addr: params.street, lastLine }, responseMeta: { match: 'none', matchCode: 'N', httpStatus: response.status } });
        return vendorSuccess<PropertySearchResult>({ match: 'none', property: null, locations: [] }, { requestId, durationMs });
      }

      if (outcome.kind === 'multi_match') {
        const locations = mapLocations(outcome.raw);
        await logRequest({ operation: 'property_search', requestId, startedAt, success: true, requestMeta: { addr: params.street, lastLine }, responseMeta: { match: 'multi', matchCode: 'M', httpStatus: response.status, locationCount: locations.length, candidates: locations.slice(0, 10) } });
        return vendorSuccess<PropertySearchResult>({ match: 'multi', property: null, locations }, { requestId, durationMs });
      }

      await logRequest({ operation: 'property_search', requestId, startedAt, success: false, errorCategory: 'API_ERROR', requestMeta: { addr: params.street, lastLine }, responseMeta: { status: response.status, body: outcome.body.slice(0, 500) } });
      return vendorError<PropertySearchResult>(VENDOR, 'SEARCH_FAILED', `SiteX ${response.status}`, { httpStatus: response.status, retryable: response.status >= 500, requestId, durationMs });
    }

    const raw = (await response.json()) as SiteXSearchResponse;
    const matchCode = inferMatchCode(raw);

    let result: PropertySearchResult;
    if (matchCode === 'S' && raw.Feed?.PropertyProfile) {
      result = { match: 'single', property: { matchCode: 'S' as const, ...mapProfile(raw.Feed.PropertyProfile) }, locations: [] };
    } else if (matchCode === 'M' && raw.Locations) {
      result = { match: 'multi', property: null, locations: raw.Locations.map((loc) => ({ address: loc.Address ?? '', city: loc.City ?? '', state: loc.State ?? '', zip: loc.Zip ?? '', apn: loc.APN ?? '' })) };
    } else {
      result = { match: 'none', property: null, locations: [] };
    }

    await logRequest({ operation: 'property_search', requestId, startedAt, success: true, requestMeta: { addr: params.street, lastLine }, responseMeta: { match: result.match, locationCount: result.locations.length } });
    return vendorSuccess(result, { requestId, durationMs });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const durationMs = Date.now() - startedAt.getTime();
    await logRequest({ operation: 'property_search', requestId, startedAt, success: false, errorCategory: 'NETWORK', requestMeta: { addr: params.street, lastLine }, responseMeta: { error: message } });
    return vendorError<PropertySearchResult>(VENDOR, 'NETWORK_ERROR', message, { retryable: true, requestId, durationMs });
  }
}

export async function propertyLookup(
  params: PropertyLookupParams
): Promise<VendorResult<SiteXPropertyData>> {
  const requestId = crypto.randomUUID();
  const startedAt = new Date();
  const config = getConfig();

  if (!config) {
    await logRequest({ operation: 'property_lookup_mock', requestId, startedAt, success: true, requestMeta: { ...params, mock: true } });
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
    const response = await fetch(searchUrl.toString(), { method: 'GET', headers: { 'Authorization': `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const durationMs = Date.now() - startedAt.getTime();

    if (!response.ok) {
      const outcome = await classifyNonOk(response);

      if (outcome.kind === 'no_match') {
        await logRequest({ operation: 'property_lookup', requestId, startedAt, success: true, requestMeta: { addr: params.street, lastLine, feedId: config.feedId }, responseMeta: { matchCode: 'N', httpStatus: response.status } });
        return vendorSuccess<SiteXPropertyData>(emptyResult('N'), { requestId, durationMs });
      }

      if (outcome.kind === 'multi_match') {
        // Candidates are recorded on the log so an ambiguous address can be
        // resolved later. The returned matchCode stays 'M', which every
        // consumer already refuses to auto-fill from.
        const candidates = mapLocations(outcome.raw);
        await logRequest({ operation: 'property_lookup', requestId, startedAt, success: true, requestMeta: { addr: params.street, lastLine, feedId: config.feedId }, responseMeta: { matchCode: 'M', httpStatus: response.status, locationCount: candidates.length, candidates: candidates.slice(0, 10) } });
        return vendorSuccess<SiteXPropertyData>(emptyResult('M'), { requestId, durationMs });
      }

      await logRequest({ operation: 'property_lookup', requestId, startedAt, success: false, errorCategory: 'API_ERROR', requestMeta: { addr: params.street, lastLine, feedId: config.feedId }, responseMeta: { status: response.status, body: outcome.body.slice(0, 500) } });
      return vendorError<SiteXPropertyData>(VENDOR, 'SEARCH_FAILED', `SiteX ${response.status}`, { httpStatus: response.status, retryable: response.status >= 500, requestId, durationMs });
    }

    const raw = (await response.json()) as SiteXSearchResponse;
    const matchCode = inferMatchCode(raw);
    let result: SiteXPropertyData;
    if (matchCode === 'S' && raw.Feed?.PropertyProfile) { result = { matchCode: 'S', ...mapProfile(raw.Feed.PropertyProfile) }; }
    else if (matchCode === 'M') { result = emptyResult('M'); }
    else { result = emptyResult('N'); }

    await logRequest({ operation: 'property_lookup', requestId, startedAt, success: true, requestMeta: { addr: params.street, lastLine, feedId: config.feedId }, responseMeta: { matchCode: result.matchCode, apn: result.apn } });
    return vendorSuccess(result, { requestId, durationMs });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const durationMs = Date.now() - startedAt.getTime();
    await logRequest({ operation: 'property_lookup', requestId, startedAt, success: false, errorCategory: 'NETWORK', requestMeta: { addr: params.street, lastLine }, responseMeta: { error: message } });
    return vendorError<SiteXPropertyData>(VENDOR, 'NETWORK_ERROR', message, { retryable: true, requestId, durationMs });
  }
}

export async function apnLookup(
  params: ApnLookupParams
): Promise<VendorResult<SiteXPropertyData>> {
  const requestId = crypto.randomUUID();
  const startedAt = new Date();
  const config = getConfig();

  if (!config) {
    await logRequest({ operation: 'apn_lookup_mock', requestId, startedAt, success: true, requestMeta: { ...params, mock: true } });
    return vendorSuccess(MOCK_PROPERTY, { requestId, durationMs: 0 });
  }

  const searchUrl = new URL(`${config.baseUrl}/realestatedata/search`);
  searchUrl.searchParams.set('apn', params.apn);
  searchUrl.searchParams.set('county', params.county);
  searchUrl.searchParams.set('state', params.state ?? 'CA');
  searchUrl.searchParams.set('feedId', config.feedId);

  try {
    const token = await getAccessToken(config.baseUrl, config.clientId, config.clientSecret);
    const response = await fetch(searchUrl.toString(), { method: 'GET', headers: { 'Authorization': `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const durationMs = Date.now() - startedAt.getTime();

    if (!response.ok) {
      const outcome = await classifyNonOk(response);

      if (outcome.kind === 'no_match') {
        await logRequest({ operation: 'apn_lookup', requestId, startedAt, success: true, requestMeta: { apn: params.apn, county: params.county }, responseMeta: { matchCode: 'N', httpStatus: response.status } });
        return vendorSuccess<SiteXPropertyData>(emptyResult('N'), { requestId, durationMs });
      }

      if (outcome.kind === 'multi_match') {
        const candidates = mapLocations(outcome.raw);
        await logRequest({ operation: 'apn_lookup', requestId, startedAt, success: true, requestMeta: { apn: params.apn, county: params.county }, responseMeta: { matchCode: 'M', httpStatus: response.status, locationCount: candidates.length, candidates: candidates.slice(0, 10) } });
        return vendorSuccess<SiteXPropertyData>(emptyResult('M'), { requestId, durationMs });
      }

      await logRequest({ operation: 'apn_lookup', requestId, startedAt, success: false, errorCategory: 'API_ERROR', requestMeta: { apn: params.apn, county: params.county }, responseMeta: { status: response.status, body: outcome.body.slice(0, 500) } });
      return vendorError<SiteXPropertyData>(VENDOR, 'SEARCH_FAILED', `SiteX ${response.status}`, { httpStatus: response.status, retryable: response.status >= 500, requestId, durationMs });
    }

    const raw = (await response.json()) as SiteXSearchResponse;
    const matchCode = inferMatchCode(raw);
    let result: SiteXPropertyData;
    if (matchCode === 'S' && raw.Feed?.PropertyProfile) { result = { matchCode: 'S', ...mapProfile(raw.Feed.PropertyProfile) }; }
    else if (matchCode === 'M') { result = emptyResult('M'); }
    else { result = emptyResult('N'); }

    await logRequest({ operation: 'apn_lookup', requestId, startedAt, success: true, requestMeta: { apn: params.apn, county: params.county }, responseMeta: { matchCode: result.matchCode, apn: result.apn } });
    return vendorSuccess(result, { requestId, durationMs });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const durationMs = Date.now() - startedAt.getTime();
    await logRequest({ operation: 'apn_lookup', requestId, startedAt, success: false, errorCategory: 'NETWORK', requestMeta: { apn: params.apn, county: params.county }, responseMeta: { error: message } });
    return vendorError<SiteXPropertyData>(VENDOR, 'NETWORK_ERROR', message, { retryable: true, requestId, durationMs });
  }
}

export { type PropertySearchResult } from './parsers';
export { type SiteXPropertyData, type PropertyLookupParams, type ApnLookupParams } from './types';
