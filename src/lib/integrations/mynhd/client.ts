import crypto from 'node:crypto';
import {
  AUTH_TIMEOUT_MS, MyNhdAuthError, PRODUCTION_BASE_URL, TIMEOUT_MS, VENDOR,
  configRefusalMessage, getAccessToken, logRequest, readConfig,
} from './auth';

// ─── MyNHD flood-and-fire preview ────────────────────────────────────────────
//
// Vendor documentation: docs/vendor-reports/mynhd/MyNHD-Preview-API-integration-guide.html
// Design: docs/vendor-reports/mynhd/CONCIERGE_MYNHD_PREVIEW.md
//
// FREE TO PCT. Gerard, 12 Oct 2026. There is no charge to record and no credit
// to reconcile, which is why nothing here counts anything — and why
// routes.test.ts asserts the route that calls this is NOT one of the two named
// spenders. A vendor call is still a vendor call: it is logged, and the claim
// key still stops two clicks making two of them.
//
// ─── THE TRAP: HTTP 200 IS NOT AN ANSWER ─────────────────────────────────────
//
// A multi-match comes back as HTTP **200** with:
//
//   { "success": false, "code": "multi_result",
//     "error": "Preview skipped: multiple properties found for this address." }
//
// No image_data, no order_link, nothing to show. The guide says it in as many
// words — "Do not treat HTTP 200 alone as a successful preview" — and this is
// the SiteX 300 wearing the opposite status code: there, an ordinary answer
// arrived as an error status and we called it a failure; here a non-answer
// arrives as a success status and the risk is calling it a preview.
//
// So `ok` requires BOTH: 2xx, and `success === true`. Not truthy — exactly
// true, because `success` is absent on most error bodies and `undefined` must
// never pass. The guide is explicit that "error responses do not always include
// success or code", so `error` is what gets read for the message.
//
// On the Concierge path the search is by APN + FIPS, which identifies one
// parcel, so multi_result should never fire. It is handled anyway: "should
// never" is not a guard, and the SiteX 300 was also a case nobody expected to
// see on an address somebody had already picked from a list.

/** The parcel to ask about. APN + FIPS only — see the header. */
export interface PreviewByApn {
  apn: string;
  /** Five-digit county FIPS. The vendor calls this field `county`. */
  fips: string;
  /** Uppercase two-letter state. */
  state: string;
}

export type PreviewFailure =
  | 'not_configured'
  /**
   * The production deploy is pointed at a non-production MyNHD host. Refused
   * before any request: a development key and a production deploy must not be
   * crossable. Distinct from `not_configured`, because the key IS set and
   * saying otherwise sends somebody looking in the wrong place.
   */
  | 'wrong_environment'
  | 'auth_failed'
  /** HTTP 403 — the account has no preview entitlement. */
  | 'no_permission'
  /** HTTP 200 + success:false + code:multi_result. */
  | 'multi_result'
  /** 2xx and success true, but no usable document came with it. */
  | 'no_document'
  | 'api_error'
  | 'network';

export interface PreviewEvidence {
  /** The HTTP status, which on its own decides nothing. See the header. */
  httpStatus: number | null;
  /** The vendor's own `success`, as sent: true, false, or absent. */
  success: boolean | null;
  /** The vendor's own `code`, e.g. `multi_result`. */
  code: string | null;
  /** The vendor's own `error` message. */
  error: string | null;
  /** Whether the token was refreshed and the call retried. */
  reAuthed: boolean;
}

export type PreviewResult =
  | {
    ok: true;
    /**
     * Decoded PDF bytes. Not base64 — callers store a file, not a string.
     *
     * THE PDF, NOT THE PNG. Both endpoints return the same one-page hazard
     * preview; `/image` sends it as a 1024px-wide raster, which across the
     * document's 528pt content width is 140 dpi and puts the disclaimer type
     * at about 5pt, blurred. Measured, not guessed —
     * fixtures/first-real-preview.json. `/pdf` sends it with vector text, so
     * rasterising it ourselves at 300 dpi gives a sheet that is sharp at full
     * width. The caller does that; see domain/concierge/rasterize-pdf.ts.
     */
    pdf: Buffer;
    /** Where the homeowner can order the full report, from the same response. */
    orderLink: string | null;
    evidence: PreviewEvidence;
    durationMs: number;
  }
  | {
    ok: false;
    reason: PreviewFailure;
    message: string;
    evidence: PreviewEvidence | null;
    durationMs: number;
  };

interface RawPreview {
  success?: unknown;
  code?: unknown;
  error?: unknown;
  pdf_data?: unknown;
  order_link?: unknown;
  tryReAuth?: unknown;
}

function readEvidence(status: number, body: RawPreview | null, reAuthed: boolean): PreviewEvidence {
  return {
    httpStatus: status,
    // Exactly true / exactly false / absent. Anything else is absent, not false:
    // "the vendor sent something we do not understand" is not "the vendor said no".
    success: body?.success === true ? true : body?.success === false ? false : null,
    code: typeof body?.code === 'string' ? body.code : null,
    error: typeof body?.error === 'string' ? body.error : null,
    reAuthed,
  };
}

/**
 * Is this response a preview?
 *
 * The whole of the trap, in one place and exported so it can be tested without
 * a network. 2xx AND success === true. Nothing else.
 */
export function isPreview(status: number, body: { success?: unknown } | null): boolean {
  return status >= 200 && status < 300 && body?.success === true;
}

/** Does a 401 say to get a new token and try once more? */
export function saysReAuth(status: number, body: { tryReAuth?: unknown } | null): boolean {
  return status === 401 && body?.tryReAuth === true;
}

/**
 * One flood-and-fire PNG preview for one parcel.
 *
 * Retries EXACTLY ONCE, and only on 401 + tryReAuth with a fresh token. Not on
 * a 500, not on a timeout: a retry loop against a vendor we do not pay per call
 * is still a retry loop against somebody else's rate limit, and the sweeper
 * already re-attempts on its own schedule.
 */
export async function fetchFloodFirePreview(params: PreviewByApn): Promise<PreviewResult> {
  const requestId = crypto.randomUUID();
  const startedAt = new Date();
  const read = readConfig();

  if (!read.ok) {
    // No mock, no fallback, and NOTHING ON THE WIRE. Two reasons land here and
    // they are different in kind: no secret is "not set up", while a
    // non-production host on the production deploy is a misconfiguration that
    // must not be allowed to reach the vendor at all. Both are reported with
    // the reason, because "MyNHD is not configured" on a deploy where the key
    // IS configured would send somebody looking in the wrong place.
    const refused: PreviewFailure = read.reason === 'no_secret' ? 'not_configured' : 'wrong_environment';
    return {
      ok: false, reason: refused, evidence: null, durationMs: 0,
      message: configRefusalMessage(read.reason),
    };
  }
  const config = read.config;

  const url = `${config.baseUrl}/report/getMultiFloodFirePreview/pdf`;
  // `county` is the vendor's name for a five-digit FIPS. Their field, their
  // spelling — the mismatch is theirs and renaming it here would hide it.
  const payload = {
    search: 'apn' as const,
    apn: params.apn.trim(),
    county: params.fips.trim(),
    state: params.state.trim().toUpperCase(),
  };

  // WHAT WENT ON THE WIRE, and never the secret. The orders flow learned on
  // 2026-09-09 that a request log omitting the field under test cannot verify
  // the change; the inverse rule is that a log must never carry a credential.
  const requestMeta = {
    endpoint: '/report/getMultiFloodFirePreview/pdf',
    search: 'apn', apn: payload.apn, county: payload.county, state: payload.state,
    // WHICH MyNHD. The code refuses a crossing, and this is how one would be
    // VISIBLE after the fact — an enforced invariant nobody can audit from the
    // data is an invariant you have to take on trust.
    host: new URL(config.baseUrl).host,
    isProductionHost: config.baseUrl === PRODUCTION_BASE_URL,
    vercelEnv: process.env.VERCEL_ENV ?? null,
  };

  try {
    let reAuthed = false;
    let token = await getAccessToken();
    let response = await post(url, token, payload);
    let raw = await response.text();
    let body = parse(raw);

    // ─── 401 + tryReAuth: one new token, one retry ──────────────────────────
    if (saysReAuth(response.status, body)) {
      reAuthed = true;
      token = await getAccessToken(true);
      response = await post(url, token, payload);
      raw = await response.text();
      body = parse(raw);
    }

    const durationMs = Date.now() - startedAt.getTime();
    const evidence = readEvidence(response.status, body, reAuthed);

    // ─── THE ONE CHECK THAT MATTERS ─────────────────────────────────────────
    if (!isPreview(response.status, body)) {
      const reason = classify(response.status, evidence);
      const message = failureMessage(reason, evidence);
      await logRequest({
        operation: 'mynhd_preview', requestId, startedAt, success: false,
        errorCategory: reason,
        requestMeta,
        responseMeta: {
          // STRUCTURED, not a clipped body string. The SiteX 300 investigation
          // lost the candidate count to a 400-character truncation of the one
          // field that would have answered the question.
          httpStatus: evidence.httpStatus, success: evidence.success,
          code: evidence.code, error: evidence.error, reAuthed, durationMs,
        },
      });
      return { ok: false, reason, message, evidence, durationMs };
    }

    const b64 = typeof body?.pdf_data === 'string' ? body.pdf_data : '';
    const pdf = b64 === '' ? null : decodeBase64(b64);

    if (!pdf || pdf.length === 0) {
      // success:true and no bytes. Not a preview, whatever it says about itself.
      const message = 'MyNHD reported a successful preview but sent no document.';
      await logRequest({
        operation: 'mynhd_preview', requestId, startedAt, success: false,
        errorCategory: 'no_document', requestMeta,
        responseMeta: { httpStatus: evidence.httpStatus, success: true, pdfDataChars: b64.length, reAuthed, durationMs },
      });
      return { ok: false, reason: 'no_document', message, evidence, durationMs };
    }

    const orderLink = typeof body?.order_link === 'string' && body.order_link.trim() !== ''
      ? body.order_link.trim()
      : null;

    await logRequest({
      operation: 'mynhd_preview', requestId, startedAt, success: true,
      requestMeta,
      responseMeta: {
        httpStatus: evidence.httpStatus, success: true, pdfBytes: pdf.length,
        hasOrderLink: orderLink !== null, reAuthed, durationMs,
      },
    });

    return { ok: true, pdf, orderLink, evidence, durationMs };
  } catch (err) {
    const durationMs = Date.now() - startedAt.getTime();
    const authFailure = err instanceof MyNhdAuthError;
    const message = err instanceof Error ? err.message : 'Unknown error';
    await logRequest({
      operation: 'mynhd_preview', requestId, startedAt, success: false,
      errorCategory: authFailure ? 'auth_failed' : 'NETWORK',
      requestMeta, responseMeta: { error: message, durationMs },
    });
    return {
      ok: false, reason: authFailure ? 'auth_failed' : 'network',
      message, evidence: null, durationMs,
    };
  }
}

function post(url: string, token: string, payload: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

function parse(raw: string): RawPreview | null {
  try {
    const v = JSON.parse(raw) as unknown;
    return v !== null && typeof v === 'object' ? (v as RawPreview) : null;
  } catch {
    return null;
  }
}

/**
 * Plain base64, no `data:` prefix — the guide says so, and a prefix that slipped
 * through would decode to leading garbage rather than failing, so it is
 * stripped rather than trusted.
 */
function decodeBase64(b64: string): Buffer | null {
  const cleaned = b64.replace(/^data:[^;]*;base64,/, '').replace(/\s+/g, '');
  if (cleaned === '') return null;
  const buf = Buffer.from(cleaned, 'base64');
  // Buffer.from is forgiving: it drops invalid characters and returns whatever
  // it managed. The five-byte PDF signature is the cheap check that we have a
  // document rather than a decoded error string.
  return isPdf(buf) ? buf : null;
}

/**
 * `%PDF-`, the five bytes every PDF starts with.
 *
 * This replaced an eight-byte PNG signature check when the source moved from
 * `/image` to `/pdf`. The check itself is the point rather than the bytes: a
 * success response carrying something that is not the document it claims is
 * not a preview, and without this it becomes a blank sheet on a client's
 * report instead of a refusal.
 */
const PDF_SIGNATURE = Buffer.from('%PDF-', 'latin1');

export function isPdf(buf: Buffer): boolean {
  return buf.length > PDF_SIGNATURE.length && buf.subarray(0, PDF_SIGNATURE.length).equals(PDF_SIGNATURE);
}

function classify(status: number, e: PreviewEvidence): PreviewFailure {
  if (e.code === 'multi_result') return 'multi_result';
  if (status === 403) return 'no_permission';
  if (status === 401) return 'auth_failed';
  // A 2xx that is not a preview and does not say multi_result: the vendor
  // declined for a reason of its own, which `error` carries.
  return 'api_error';
}

export function failureMessage(reason: PreviewFailure, e: PreviewEvidence | null): string {
  const vendorSaid = e?.error?.trim();
  switch (reason) {
    case 'not_configured':
      return configRefusalMessage('no_secret');
    case 'wrong_environment':
      return configRefusalMessage('dev_url_on_production');
    case 'auth_failed':
      return 'MyNHD would not accept our credentials, so no hazard preview was added.';
    case 'no_permission':
      return 'This MyNHD account does not have preview access. MyNHD has to enable it.';
    case 'multi_result':
      return 'MyNHD found more than one property for this parcel, so no preview was generated.';
    case 'no_document':
      return 'MyNHD reported a successful preview but sent no document.';
    case 'network':
      return 'MyNHD could not be reached, so no hazard preview was added.';
    case 'api_error':
      return vendorSaid
        ? `MyNHD did not return a preview: ${vendorSaid}`
        : 'MyNHD did not return a preview.';
  }
}

export { VENDOR, AUTH_TIMEOUT_MS };
