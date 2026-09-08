import { vendorSuccess, vendorError } from '../types';
import type { VendorResult } from '../types';
import type { SiteXPropertyData, SiteXSearchResponse, PropertyLookupParams, ApnLookupParams } from './types';
import { VENDOR, TIMEOUT_MS, getConfig, getAccessToken, logRequest } from './auth';
import { fips5From } from '@/lib/integrations/cpl/county-fips';
import { truncateZip, mapProfile, emptyResult } from './parsers';
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

/**
 * The multi-match candidate list, as the UI needs it.
 *
 * KEEP THE UNIT. SiteX returns `UnitNumber` and `UnitType` on every candidate
 * — confirmed from their published schema at
 * `GET /realestatedata/search/schema/{feedId}` — and dropping them here is why
 * 16281 Castello Ln, Fontana came back as six rows all reading
 * "16281 CASTELLO LN" with nothing to choose between them. An operator
 * searched it four times in six minutes and got the same unusable list.
 *
 * The zip is `ZIP`, not `Zip`. The old spelling matched no field, which is why
 * every candidate ever logged carried `"zip": ""`. `Zip` stays as a fallback.
 *
 * `FIPS` is the parcel's own county code. It is better than anything we can
 * derive from a county name, and it is what makes picking a candidate work.
 */
function mapLocations(raw: SiteXSearchResponse) {
  return (raw.Locations ?? []).map((loc) => ({
    address: loc.Address ?? '',
    city: loc.City ?? '',
    state: loc.State ?? '',
    zip: loc.ZIP ?? loc.Zip ?? '',
    apn: loc.APN ?? '',
    unitNumber: loc.UnitNumber?.trim() || null,
    unitType: loc.UnitType?.trim() || null,
    fips: loc.FIPS?.trim() || null,
  }));
}

export async function propertySearch(
  params: PropertyLookupParams
): Promise<VendorResult<PropertySearchResult>> {
  const requestId = crypto.randomUUID();
  const startedAt = new Date();
  const config = getConfig();

  if (!config) {
    // FAIL CLOSED. This used to return MOCK_PROPERTY as vendorSuccess with
    // matchCode 'S' — fabricated owner names, a real-looking APN and address —
    // indistinguishable from a genuine single match. A misconfigured deploy
    // produced confident data about a house that was not the subject. An
    // unconfigured vendor is an error, never a result.
    await logRequest({ operation: 'property_search', requestId, startedAt, success: false, errorCategory: 'NOT_CONFIGURED', requestMeta: { ...params } });
    return vendorError<PropertySearchResult>(VENDOR, 'NOT_CONFIGURED', 'SiteX is not configured (SITEX_BASE_URL missing).', { retryable: false, requestId, durationMs: 0 });
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
      // Same shape as every other multi-match path — see mapLocations.
      result = { match: 'multi', property: null, locations: mapLocations(raw) };
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
    // FAIL CLOSED. This used to return MOCK_PROPERTY as vendorSuccess with
    // matchCode 'S' — fabricated owner names, a real-looking APN and address —
    // indistinguishable from a genuine single match. A misconfigured deploy
    // produced confident data about a house that was not the subject. An
    // unconfigured vendor is an error, never a result.
    await logRequest({ operation: 'property_lookup', requestId, startedAt, success: false, errorCategory: 'NOT_CONFIGURED', requestMeta: { ...params } });
    return vendorError<SiteXPropertyData>(VENDOR, 'NOT_CONFIGURED', 'SiteX is not configured (SITEX_BASE_URL missing).', { retryable: false, requestId, durationMs: 0 });
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
    await logRequest({ operation: 'apn_lookup', requestId, startedAt, success: false, errorCategory: 'NOT_CONFIGURED', requestMeta: { ...params } });
    // FAIL CLOSED. This used to return MOCK_PROPERTY as vendorSuccess with
    // matchCode 'S' — fabricated owner names, a real-looking APN and address —
    // indistinguishable from a genuine single match. A misconfigured deploy
    // produced confident data about a house that was not the subject. An
    // unconfigured vendor is an error, never a result.
    return vendorError<SiteXPropertyData>(VENDOR, 'NOT_CONFIGURED', 'SiteX is not configured (SITEX_BASE_URL missing).', { retryable: false, requestId, durationMs: 0 });
  }

  // ─── APN search takes `fips`, not `county` + `state` ──────────────────────
  //
  // SiteXPro's own OpenAPI, from the free, non-billable
  // GET /realestatedata/search/schema/{feedId}, documents exactly twelve query
  // parameters on /search:
  //
  //   addr, lastLine, owner, fips, apn, zip, clientReference, options,
  //   feedId, isMailingAddress, latitude, longitude
  //
  // `county` and `state` are NOT among them. They were silently ignored,
  // leaving apn + feedId — a search with no locality — which SiteX rejected as
  // "Missing required fields" on all 13 attempts this endpoint has ever made.
  // Zero of them succeeded.
  //
  // The APN is trimmed because an operator retrying by hand pasted one with a
  // leading space. That was NOT the cause — 1 of 13 calls, and 0 of 6,061
  // stored APNs — but a space would break a search that otherwise works.
  const fips = fips5From(params.fips, params.county, params.state);

  // WHEN THE VENDOR AND OUR TABLE DISAGREE, SAY SO.
  //
  // params.fips is SiteX's own code for the parcel; fips5From(null, county,
  // state) is ours, derived from a county-name table covering three states.
  // Preferring theirs is right, but silently preferring it would mean a wrong
  // row in our table is never discovered — we would quietly get the correct
  // answer forever and keep shipping the bad county to Westcor, which uses the
  // same table. One log line, so the disagreement is findable.
  if (params.fips) {
    const derived = fips5From(null, params.county, params.state);
    if (derived && derived !== fips) {
      await logRequest({
        operation: 'apn_lookup', requestId, startedAt, success: false,
        errorCategory: 'FIPS_TABLE_DISAGREES',
        requestMeta: { apn: params.apn, county: params.county, state: params.state },
        responseMeta: { vendorFips: params.fips, ourFips: derived, using: fips },
      });
    }
  }

  // Without a FIPS this request is `apn` + `feedId` — byte-for-byte the shape
  // that failed all 13 times. Sending it anyway would spend a round trip to be
  // told "Missing required fields" again, and the operator would be shown a
  // vendor error for something we could see before asking. An unresolvable
  // county is our problem, so it is reported as ours.
  if (!fips) {
    await logRequest({
      operation: 'apn_lookup', requestId, startedAt, success: false,
      errorCategory: 'UNRESOLVED_COUNTY',
      requestMeta: { apn: params.apn, county: params.county, state: params.state },
      responseMeta: { error: 'No FIPS could be derived; request not sent.' },
    });
    return vendorError<SiteXPropertyData>(
      VENDOR, 'UNRESOLVED_COUNTY',
      `Could not determine the FIPS code for county "${params.county ?? ''}" in ${params.state ?? 'CA'}.`,
      { retryable: false, requestId, durationMs: Date.now() - startedAt.getTime() },
    );
  }

  const searchUrl = new URL(`${config.baseUrl}/realestatedata/search`);
  searchUrl.searchParams.set('apn', params.apn.trim());
  searchUrl.searchParams.set('fips', fips);
  searchUrl.searchParams.set('feedId', config.feedId);

  // LOG WHAT WE SENT, NOT WHAT WE WERE ASKED FOR.
  //
  // This log used to record { apn, county } — the caller's arguments. When the
  // fips fix was verified on 2026-09-09 the log could show the call succeeded
  // but not that `fips=06037` had gone on the wire, because the parameter the
  // fix introduced was the one parameter absent from the log. A request log
  // that omits the field under test cannot verify the change.
  const apnRequestMeta = {
    apn: params.apn.trim(),
    fips,
    fipsSource: params.fips ? 'caller' : 'derived',
    county: params.county,
    state: params.state ?? null,
    url: searchUrl.toString().replace(/([?&]feedId=)[^&]*/, '$1<redacted>'),
  };

  try {
    const token = await getAccessToken(config.baseUrl, config.clientId, config.clientSecret);
    const response = await fetch(searchUrl.toString(), { method: 'GET', headers: { 'Authorization': `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const durationMs = Date.now() - startedAt.getTime();

    if (!response.ok) {
      const outcome = await classifyNonOk(response);

      if (outcome.kind === 'no_match') {
        await logRequest({ operation: 'apn_lookup', requestId, startedAt, success: true, requestMeta: apnRequestMeta, responseMeta: { matchCode: 'N', httpStatus: response.status } });
        return vendorSuccess<SiteXPropertyData>(emptyResult('N'), { requestId, durationMs });
      }

      if (outcome.kind === 'multi_match') {
        const candidates = mapLocations(outcome.raw);
        await logRequest({ operation: 'apn_lookup', requestId, startedAt, success: true, requestMeta: apnRequestMeta, responseMeta: { matchCode: 'M', httpStatus: response.status, locationCount: candidates.length, candidates: candidates.slice(0, 10) } });
        return vendorSuccess<SiteXPropertyData>(emptyResult('M'), { requestId, durationMs });
      }

      await logRequest({ operation: 'apn_lookup', requestId, startedAt, success: false, errorCategory: 'API_ERROR', requestMeta: apnRequestMeta, responseMeta: { status: response.status, body: outcome.body.slice(0, 500) } });
      return vendorError<SiteXPropertyData>(VENDOR, 'SEARCH_FAILED', `SiteX ${response.status}`, { httpStatus: response.status, retryable: response.status >= 500, requestId, durationMs });
    }

    const raw = (await response.json()) as SiteXSearchResponse;
    const matchCode = inferMatchCode(raw);
    let result: SiteXPropertyData;
    if (matchCode === 'S' && raw.Feed?.PropertyProfile) { result = { matchCode: 'S', ...mapProfile(raw.Feed.PropertyProfile) }; }
    else if (matchCode === 'M') { result = emptyResult('M'); }
    else { result = emptyResult('N'); }

    await logRequest({ operation: 'apn_lookup', requestId, startedAt, success: true, requestMeta: apnRequestMeta, responseMeta: { matchCode: result.matchCode, apn: result.apn } });
    return vendorSuccess(result, { requestId, durationMs });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const durationMs = Date.now() - startedAt.getTime();
    await logRequest({ operation: 'apn_lookup', requestId, startedAt, success: false, errorCategory: 'NETWORK', requestMeta: apnRequestMeta, responseMeta: { error: message } });
    return vendorError<SiteXPropertyData>(VENDOR, 'NETWORK_ERROR', message, { retryable: true, requestId, durationMs });
  }
}

export { type PropertySearchResult } from './parsers';
export { type SiteXPropertyData, type PropertyLookupParams, type ApnLookupParams } from './types';
