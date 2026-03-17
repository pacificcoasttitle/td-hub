import { vendorSuccess, vendorError } from '../types';
import type { VendorResult } from '../types';
import type { SiteXPropertyData, SiteXSearchResponse, PropertyLookupParams, ApnLookupParams } from './types';
import { VENDOR, TIMEOUT_MS, getConfig, getAccessToken, logRequest } from './auth';
import { truncateZip, mapProfile, emptyResult, MOCK_PROPERTY } from './parsers';
import type { PropertySearchResult } from './parsers';

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
      const errorBody = await response.text().catch(() => '');
      await logRequest({ operation: 'property_search', requestId, startedAt, success: false, errorCategory: 'API_ERROR', requestMeta: { addr: params.street, lastLine }, responseMeta: { status: response.status, body: errorBody.slice(0, 500) } });
      return vendorError<PropertySearchResult>(VENDOR, 'SEARCH_FAILED', `SiteX ${response.status}`, { httpStatus: response.status, retryable: response.status >= 500, requestId, durationMs });
    }

    const raw = (await response.json()) as SiteXSearchResponse;
    const matchCode = (raw.MatchCode ?? 'N').toUpperCase();

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
      const errorBody = await response.text().catch(() => '');
      await logRequest({ operation: 'property_lookup', requestId, startedAt, success: false, errorCategory: 'API_ERROR', requestMeta: { addr: params.street, lastLine, feedId: config.feedId }, responseMeta: { status: response.status, body: errorBody.slice(0, 500) } });
      return vendorError<SiteXPropertyData>(VENDOR, 'SEARCH_FAILED', `SiteX ${response.status}`, { httpStatus: response.status, retryable: response.status >= 500, requestId, durationMs });
    }

    const raw = (await response.json()) as SiteXSearchResponse;
    const matchCode = (raw.MatchCode ?? 'N').toUpperCase();
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
      const errorBody = await response.text().catch(() => '');
      await logRequest({ operation: 'apn_lookup', requestId, startedAt, success: false, errorCategory: 'API_ERROR', requestMeta: { apn: params.apn, county: params.county }, responseMeta: { status: response.status, body: errorBody.slice(0, 500) } });
      return vendorError<SiteXPropertyData>(VENDOR, 'SEARCH_FAILED', `SiteX ${response.status}`, { httpStatus: response.status, retryable: response.status >= 500, requestId, durationMs });
    }

    const raw = (await response.json()) as SiteXSearchResponse;
    const matchCode = (raw.MatchCode ?? 'N').toUpperCase();
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
