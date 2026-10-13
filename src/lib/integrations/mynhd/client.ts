import crypto from 'node:crypto';
import {
  AUTH_TIMEOUT_MS, MyNhdAuthError, TIMEOUT_MS, VENDOR,
  getAccessToken, getConfig, logRequest,
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
  | 'auth_failed'
  /** HTTP 403 — the account has no preview entitlement. */
  | 'no_permission'
  /** HTTP 200 + success:false + code:multi_result. */
  | 'multi_result'
  /** 2xx and success true, but no image bytes came with it. */
  | 'no_image'
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
    /** Decoded PNG bytes. Not base64 — callers store a file, not a string. */
    png: Buffer;
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
  image_data?: unknown;
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
  const config = getConfig();

  if (!config) {
    // No mock, no fallback. An unconfigured vendor produces no preview.
    return {
      ok: false, reason: 'not_configured', evidence: null, durationMs: 0,
      message: 'MyNHD is not configured (MYNHD_SECRET_KEY missing). No hazard preview was requested.',
    };
  }

  const url = `${config.baseUrl}/report/getMultiFloodFirePreview/image`;
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
    endpoint: '/report/getMultiFloodFirePreview/image',
    search: 'apn', apn: payload.apn, county: payload.county, state: payload.state,
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

    const b64 = typeof body?.image_data === 'string' ? body.image_data : '';
    const png = b64 === '' ? null : decodeBase64(b64);

    if (!png || png.length === 0) {
      // success:true and no bytes. Not a preview, whatever it says about itself.
      const message = 'MyNHD reported a successful preview but sent no image data.';
      await logRequest({
        operation: 'mynhd_preview', requestId, startedAt, success: false,
        errorCategory: 'no_image', requestMeta,
        responseMeta: { httpStatus: evidence.httpStatus, success: true, imageDataChars: b64.length, reAuthed, durationMs },
      });
      return { ok: false, reason: 'no_image', message, evidence, durationMs };
    }

    const orderLink = typeof body?.order_link === 'string' && body.order_link.trim() !== ''
      ? body.order_link.trim()
      : null;

    await logRequest({
      operation: 'mynhd_preview', requestId, startedAt, success: true,
      requestMeta,
      responseMeta: {
        httpStatus: evidence.httpStatus, success: true, pngBytes: png.length,
        hasOrderLink: orderLink !== null, reAuthed, durationMs,
      },
    });

    return { ok: true, png, orderLink, evidence, durationMs };
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
  // it managed. An eight-byte PNG signature is the cheap check that we have an
  // image rather than a decoded error string.
  return isPng(buf) ? buf : null;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** The eight-byte PNG signature. Exported for the fixture guard. */
export function isPng(buf: Buffer): boolean {
  return buf.length > 8 && buf.subarray(0, 8).equals(PNG_SIGNATURE);
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
      return 'MyNHD is not configured, so no hazard preview was requested.';
    case 'auth_failed':
      return 'MyNHD would not accept our credentials, so no hazard preview was added.';
    case 'no_permission':
      return 'This MyNHD account does not have preview access. MyNHD has to enable it.';
    case 'multi_result':
      return 'MyNHD found more than one property for this parcel, so no preview was generated.';
    case 'no_image':
      return 'MyNHD reported a successful preview but sent no image data.';
    case 'network':
      return 'MyNHD could not be reached, so no hazard preview was added.';
    case 'api_error':
      return vendorSaid
        ? `MyNHD did not return a preview: ${vendorSaid}`
        : 'MyNHD did not return a preview.';
  }
}

export { VENDOR, AUTH_TIMEOUT_MS };
