import crypto from 'node:crypto';
import { getAccessToken, getConfig, logRequest, TIMEOUT_MS, VENDOR } from './auth';
// ONE CLASSIFIER, NOT TWO. client.ts already knows that SiteX answers two
// ordinary questions with non-2xx codes — 404 + NotFound means no property,
// 300 + Locations[] means several — and this file spent its whole life calling
// both of them `api_error`. Importing the classifier rather than restating it
// is the point: a third reading of a status code is how they drift.
import { classifyNonOkBody, mapLocations } from './client';

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
  /**
   * The parcel, when one is known. SEARCHED BY IN PREFERENCE TO THE ADDRESS.
   *
   * Nothing supplies these on a first attempt: there is no free resolution
   * step, so the APN arrives FROM the spend (see claim.ts). They exist for the
   * SECOND attempt — after a 300 multi-match, which costs nothing, hands back
   * a candidate per parcel and the operator picks one. Searching the same
   * ambiguous address again gets the same question back.
   *
   * Both or neither. `apn` alone is the request shape that failed all 13 times
   * in the orders flow ("Missing required fields"), so it is not sent without
   * a FIPS — see client.ts's apnLookup.
   */
  apn?: string | null;
  fips?: string | null;
}

/** One parcel SiteX offered when the address matched more than one. */
export type MatchCandidate = ReturnType<typeof mapLocations>[number];

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
  | {
    ok: false;
    reason: ConciergeGuardFailure | 'not_configured' | 'api_error' | 'network';
    message: string;
    guard: GuardEvidence | null;
    durationMs: number;
    creditsCharged: number;
    /**
     * The parcels to choose between, on `ambiguous_match` only.
     *
     * This is the answer to the question SiteX asked, and it has to travel
     * with the refusal or the refusal is unanswerable. Empty on every other
     * reason.
     */
    candidates?: MatchCandidate[];
  };

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
  const lastLine = `${params.city}, ${params.state}, ${zip5}`;
  const url = new URL(`${config.baseUrl}/realestatedata/search`);

  // BY PARCEL WHEN WE HAVE ONE, BY ADDRESS OTHERWISE.
  //
  // The address is not a fallback in the sense of "worse" — it is all we have
  // on a first attempt, because the APN only arrives from a call. It becomes
  // the wrong thing to send on a RETRY after a multi-match: the operator has
  // picked a parcel by then, and re-sending the address asks SiteX the same
  // ambiguous question it already declined to answer.
  //
  // Requires both. See ConciergeLookupParams.
  const apn = params.apn?.trim() || null;
  const fips = params.fips?.trim() || null;
  const byParcel = apn !== null && fips !== null;
  if (byParcel) {
    url.searchParams.set('apn', apn);
    url.searchParams.set('fips', fips);
  } else {
    url.searchParams.set('addr', params.street);
    url.searchParams.set('lastLine', lastLine);
  }
  url.searchParams.set('feedId', feedId);

  // What went on the wire, not what we were asked for. The orders flow learned
  // this the hard way on 2026-09-09: the log recorded the caller's arguments,
  // so it could show that a call succeeded but not that the parameter the fix
  // introduced had been sent. A request log that omits the field under test
  // cannot verify the change.
  const requestMeta = byParcel
    ? { feedId, searchedBy: 'parcel', apn, fips }
    : { feedId, searchedBy: 'address', lastLine };

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
      // Not every non-2xx is a failure. 300 + Locations[] is SiteX saying "that
      // address matches more than one property, here they are", and 404 +
      // NotFound is "there is no property there" — both ordinary answers. This
      // branch used to print the status code into a red box, which is how the
      // same address was attempted 14 times in 53 minutes with nothing to act
      // on and nothing charged.
      const outcome = classifyNonOkBody(response.status, raw);

      if (outcome.kind === 'multi_match') {
        const candidates = mapLocations(outcome.raw);
        await logRequest({
          operation: 'concierge_profile', requestId, startedAt, success: false,
          errorCategory: 'ambiguous_match',
          requestMeta,
          responseMeta: {
            httpStatus: response.status, searchId: guard?.searchId ?? null, creditsCharged,
            locationCount: candidates.length,
            // The candidates themselves, not a truncated body. The 14 logged
            // 300s recorded `body` clipped at 400 characters, so how many
            // parcels SiteX had offered is not recoverable from any of them.
            candidates: candidates.slice(0, 10),
          },
        });
        return {
          ok: false, reason: 'ambiguous_match', candidates, durationMs, creditsCharged,
          // locationCount from the candidates, since OrderInfo is absent on a 300.
          guard: guard ? { ...guard, locationCount: candidates.length } : null,
          message: ambiguousMessage(candidates.length),
        };
      }

      if (outcome.kind === 'no_match') {
        await logRequest({
          operation: 'concierge_profile', requestId, startedAt, success: false,
          errorCategory: 'no_match', requestMeta,
          responseMeta: { httpStatus: response.status, searchId: guard?.searchId ?? null, creditsCharged },
        });
        return {
          ok: false, reason: 'no_match', guard, durationMs, creditsCharged,
          message: guardMessage('no_match'),
        };
      }

      await logRequest({
        operation: 'concierge_profile', requestId, startedAt, success: false,
        errorCategory: 'API_ERROR',
        requestMeta,
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
      // A 200 can also be a multi-match — SiteX sometimes answers with Locations[]
      // and a 2xx, which is why evaluateGuard has this case at all. That one DID
      // charge, so picking a candidate costs a second credit; the candidates
      // still travel, because the alternative is the same dead end at a higher
      // price.
      const candidates = failure === 'ambiguous_match' && Array.isArray(payload.Locations)
        ? mapLocations(payload as Parameters<typeof mapLocations>[0])
        : undefined;
      return {
        ok: false, reason: failure, guard, durationMs, creditsCharged, candidates,
        message: failure === 'ambiguous_match'
          ? ambiguousMessage(guard!.locationCount ?? 0)
          : guardMessage(failure),
      };
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

/**
 * What a multi-match says to the operator.
 *
 * It says the COUNT, and it says nothing was charged. The old wording —
 * "Resolve it before generating a profile" — told somebody to go and do a thing
 * with no way to do it, and the 300 path never even reached it: that attempt
 * got "SiteX returned HTTP 300". A status code is not an instruction.
 */
export function ambiguousMessage(count: number): string {
  const n = count > 0 ? `${count} properties` : 'more than one property';
  return `This address matches ${n}. Pick the one you want — nothing has been charged.`;
}

export function guardMessage(f: ConciergeGuardFailure): string {
  switch (f) {
    case 'invalid_address': return 'SiteX did not recognise this address. No profile was generated.';
    case 'outside_coverage': return 'This property is outside SiteX coverage. No profile was generated.';
    case 'no_match': return 'No property matched this address. No profile was generated.';
    case 'ambiguous_match': return ambiguousMessage(0);
    case 'empty_feed': return 'SiteX returned no data for this property.';
  }
}

export { VENDOR };
