import crypto from 'node:crypto';
import { getAccessToken, getConfig, logRequest, TIMEOUT_MS, VENDOR } from './auth';

// ─── Concierge feed pull ─────────────────────────────────────────────────────
//
// Reuses the existing OAuth2 flow and vendor_api_logs. The only new things here
// are the feed id, the match guard, and the fact that this call COSTS MONEY.
//
// COST. A successful /search charges one credit; a 4xx charges nothing
// (measured on UAT: 292 -> 292 across a 400, 292 -> 291 across a 200).
// Production's /credits endpoint returns INT32_MAX — a sentinel, not a balance
// — so SiteX gives us no spending signal at all. sitex_search_id is therefore
// the only handle that reconciles a report against an invoice line, and it is
// recorded on every call.

/**
 * The concierge feed. Explicit and REQUIRED — no fallback to SITEX_FEED_ID even
 * though both are 100001 today. A silent fallback means retargeting one use
 * case quietly retargets the other, and nothing would fail until a report came
 * back with the wrong sections.
 */
export function getConciergeFeedId(): string {
  const id = process.env.SITEX_CONCIERGE_FEED_ID?.trim();
  if (!id) {
    throw new Error(
      'Missing SITEX_CONCIERGE_FEED_ID. The concierge profile will not fall back to '
      + 'SITEX_FEED_ID — set it explicitly (currently 100001, Title Profile_144).',
    );
  }
  return id;
}

export interface ConciergeLookupParams {
  street: string;
  city: string;
  state: string;
  zip: string;
}

export interface SiteXOrderInfo {
  IsValidAddress?: boolean;
  OutsideCoverage?: boolean;
  SearchId?: number;
  Completed?: string;
  MatchMethodCode?: string;
  MatchMethodDescription?: string;
}

export interface ConciergeFeedPayload {
  Locations?: unknown[];
  Feed?: Record<string, unknown>;
  OrderInfo?: SiteXOrderInfo;
}

export type ConciergeGuardFailure =
  | 'invalid_address'
  | 'outside_coverage'
  | 'ambiguous_match'
  | 'no_match'
  | 'empty_feed';

export interface GuardEvidence {
  isValidAddress: boolean | null;
  outsideCoverage: boolean | null;
  locationCount: number | null;
  matchMethodCode: string | null;
  searchId: number | null;
}

export type ConciergeFetchResult =
  | { ok: true; payload: ConciergeFeedPayload; raw: string; guard: GuardEvidence; durationMs: number; creditsCharged: number }
  | { ok: false; reason: ConciergeGuardFailure | 'not_configured' | 'api_error' | 'network'; message: string; guard: GuardEvidence | null; durationMs: number; creditsCharged: number };

function readGuard(payload: ConciergeFeedPayload): GuardEvidence {
  const oi = payload.OrderInfo ?? {};
  return {
    isValidAddress: typeof oi.IsValidAddress === 'boolean' ? oi.IsValidAddress : null,
    outsideCoverage: typeof oi.OutsideCoverage === 'boolean' ? oi.OutsideCoverage : null,
    locationCount: Array.isArray(payload.Locations) ? payload.Locations.length : null,
    matchMethodCode: typeof oi.MatchMethodCode === 'string' ? oi.MatchMethodCode : null,
    searchId: typeof oi.SearchId === 'number' ? oi.SearchId : null,
  };
}

/**
 * THE ANTI-WRONG-HOUSE GUARD.
 *
 * All three must hold. This is stricter than anything the legacy system had —
 * it had a fallback property, so a failed match produced a confident document
 * about the wrong house. A guard failure here produces an error and no report.
 */
export function evaluateGuard(g: GuardEvidence): ConciergeGuardFailure | null {
  if (g.isValidAddress === false) return 'invalid_address';
  if (g.outsideCoverage === true) return 'outside_coverage';
  if (g.locationCount === 0) return 'no_match';
  if (g.locationCount !== null && g.locationCount > 1) return 'ambiguous_match';
  return null;
}

/**
 * ONE billable call. Returns the raw body alongside the parsed payload so the
 * caller can hash and archive exactly what the vendor sent.
 */
export async function fetchConciergeProfile(
  params: ConciergeLookupParams,
): Promise<ConciergeFetchResult> {
  const requestId = crypto.randomUUID();
  const startedAt = new Date();
  const config = getConfig();

  // No mock, no fallback. Unconfigured means no report.
  if (!config) {
    return {
      ok: false, reason: 'not_configured', guard: null, durationMs: 0, creditsCharged: 0,
      message: 'SiteX is not configured (SITEX_BASE_URL missing). Refusing to generate a profile.',
    };
  }

  const feedId = getConciergeFeedId();
  const zip5 = params.zip.trim().slice(0, 5);
  const url = new URL(`${config.baseUrl}/realestatedata/search`);
  url.searchParams.set('addr', params.street);
  url.searchParams.set('lastLine', `${params.city}, ${params.state}, ${zip5}`);
  url.searchParams.set('feedId', feedId);

  try {
    const token = await getAccessToken(config.baseUrl, config.clientId, config.clientSecret);
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS * 2),
    });
    const durationMs = Date.now() - startedAt.getTime();
    const raw = await response.text();
    // A non-2xx is not billed; a 200 costs exactly one credit.
    const creditsCharged = response.ok ? 1 : 0;

    let payload: ConciergeFeedPayload | null = null;
    try { payload = JSON.parse(raw) as ConciergeFeedPayload; } catch { payload = null; }
    const guard = payload ? readGuard(payload) : null;

    if (!response.ok) {
      await logRequest({
        operation: 'concierge_profile', requestId, startedAt, success: false,
        errorCategory: 'API_ERROR',
        requestMeta: { feedId, lastLine: `${params.city}, ${params.state}, ${zip5}` },
        responseMeta: { httpStatus: response.status, searchId: guard?.searchId ?? null, creditsCharged, body: raw.slice(0, 400) },
      });
      return {
        ok: false, reason: 'api_error', guard, durationMs, creditsCharged,
        message: `SiteX returned HTTP ${response.status}`,
      };
    }

    if (!payload || !payload.Feed || Object.keys(payload.Feed).length === 0) {
      await logRequest({
        operation: 'concierge_profile', requestId, startedAt, success: false,
        errorCategory: 'EMPTY_FEED',
        requestMeta: { feedId }, responseMeta: { searchId: guard?.searchId ?? null, creditsCharged },
      });
      return { ok: false, reason: 'empty_feed', guard, durationMs, creditsCharged, message: 'SiteX returned no feed data.' };
    }

    const failure = evaluateGuard(guard!);
    // Log the guard values either way — they are the evidence that the guard ran.
    await logRequest({
      operation: 'concierge_profile', requestId, startedAt, success: failure === null,
      errorCategory: failure ?? undefined,
      requestMeta: { feedId },
      responseMeta: {
        searchId: guard!.searchId, creditsCharged, bytes: raw.length, durationMs,
        isValidAddress: guard!.isValidAddress, outsideCoverage: guard!.outsideCoverage,
        locationCount: guard!.locationCount, matchMethodCode: guard!.matchMethodCode,
      },
    });

    if (failure) {
      return { ok: false, reason: failure, guard, durationMs, creditsCharged, message: guardMessage(failure) };
    }

    return { ok: true, payload, raw, guard: guard!, durationMs, creditsCharged };
  } catch (err) {
    const durationMs = Date.now() - startedAt.getTime();
    const message = err instanceof Error ? err.message : 'Unknown error';
    await logRequest({
      operation: 'concierge_profile', requestId, startedAt, success: false,
      errorCategory: 'NETWORK', requestMeta: { feedId }, responseMeta: { error: message },
    });
    return { ok: false, reason: 'network', guard: null, durationMs, creditsCharged: 0, message };
  }
}

export function guardMessage(f: ConciergeGuardFailure): string {
  switch (f) {
    case 'invalid_address': return 'SiteX did not recognise this address. No profile was generated.';
    case 'outside_coverage': return 'This property is outside SiteX coverage. No profile was generated.';
    case 'no_match': return 'No property matched this address. No profile was generated.';
    case 'ambiguous_match': return 'This address matched more than one property. Resolve it before generating a profile.';
    case 'empty_feed': return 'SiteX returned no data for this property.';
  }
}

export { VENDOR };
