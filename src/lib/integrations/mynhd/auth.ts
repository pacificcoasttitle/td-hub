import { db } from '@/lib/db/client';
import { vendorApiLogs } from '@/lib/db/schema';

// ─── MyNHD auth: one token, twenty-four hours ────────────────────────────────
//
// Vendor documentation: docs/vendor-reports/mynhd/MyNHD-Preview-API-integration-guide.html
//
// THE SECRET NEVER LEAVES THE SERVER. MyNHD's CORS configuration forbids
// browser calls, and it would be wrong anyway: a secret key in a browser is a
// published secret. `MYNHD_SECRET_KEY` is read from the environment here and
// nowhere else, is never returned to a caller, and is never put in a log line.
// A `getConfig()` that returns null is the whole of "not configured" — there is
// no fallback, no mock and no default, for the same reason propertySearch
// stopped returning MOCK_PROPERTY: a misconfigured deploy must fail, not
// fabricate.
//
// ─── THE AUTH CALL IS NOT JSON ───────────────────────────────────────────────
//
// `POST /getAuthorizationHeader` takes the form field `secretkey`. The guide
// says so twice ("Authentication does not accept a JSON request body"), and a
// JSON body here is a 400 that reads like a bad key.

export const VENDOR = 'mynhd';

/** The guide's own timeouts are client settings, not promised response times. */
export const TIMEOUT_MS = 60_000;
export const AUTH_TIMEOUT_MS = 20_000;

/**
 * Asked for 24 hours, trusted for 23.
 *
 * The guide gives an expiry ("expires 24 hours after issue") and no
 * `expires_in` field, so the lifetime is ours to assume rather than read. An
 * hour of slack costs one extra auth call a day and removes the window where a
 * token we believe is live has already lapsed. Expiry is handled by the 401 +
 * tryReAuth retry regardless; this just stops that being the normal path.
 */
export const TOKEN_TTL_MS = 23 * 60 * 60 * 1000;

/**
 * MyNHD's production API, from their own guide. The fallback when
 * MYNHD_BASE_URL is unset, and the ONLY host allowed on the production target.
 */
export const PRODUCTION_BASE_URL = 'https://api.mynhd.com';

/** Why `getConfig()` returned nothing, for a caller that has to explain it. */
export type ConfigRefusal = 'no_secret' | 'dev_url_on_production';

export interface MyNhdConfig {
  baseUrl: string;
  secretKey: string;
}

const normalize = (url: string) => {
  const t = url.trim();
  return t.endsWith('/') ? t.slice(0, -1) : t;
};

/**
 * The base URL this deploy would use, independent of whether a key is present.
 *
 * Health needs to classify URL placement before production credentials arrive.
 * Keep that answer separate from readConfig(), whose job is to decide whether
 * a vendor request is allowed.
 */
export function resolveBaseUrl(): string {
  return normalize(process.env.MYNHD_BASE_URL ?? PRODUCTION_BASE_URL);
}

/**
 * Which Vercel target this is running on.
 *
 * `VERCEL_ENV` is 'production' | 'preview' | 'development' on Vercel and
 * UNSET anywhere else — a local run, a script, a test. Absent therefore means
 * "not the production deploy", which is correct rather than a hole: the app is
 * Vercel-hosted, so the production deploy always sets it, and a local run
 * pointing at the dev server is the intended case.
 */
const onProductionTarget = () => process.env.VERCEL_ENV === 'production';

/**
 * The config, or why there isn't one.
 *
 * ─── A DEV KEY AND A PROD DEPLOY MUST NOT BE CROSSABLE ──────────────────────
 *
 * MyNHD issued a DEV-ENVIRONMENT key (13 Oct 2026), which belongs on the
 * preview and development targets with MYNHD_BASE_URL pointing at their dev
 * server. The crossing to prevent is a deploy on the production target talking
 * to anything other than MyNHD's production host: that is either a dev key
 * reaching production, or a production key being sent to a dev server, and
 * neither is recoverable by noticing afterwards.
 *
 * So on the production target the base URL must BE the production URL. A
 * MYNHD_BASE_URL that is set to anything else there is refused — no call, no
 * token request, nothing on the wire.
 *
 * WHAT THIS CANNOT CHECK, STATED PLAINLY: a key is an opaque string, so there
 * is no way to tell a dev key from a production one by looking at it. If the
 * dev key is set on the production target AND no MYNHD_BASE_URL is set there,
 * this guard passes and the dev key goes to MyNHD's production host, which
 * will reject it with a 401 or 403. That is the safe direction of the failure
 * — a refusal from the vendor, not a preview generated against the wrong
 * environment — but it is a vendor-side refusal, not something caught here.
 * Keeping the key off the production target is the control that covers it, and
 * `mynhd-env-check.ts` is how to see where it actually is.
 */
export function readConfig(): { ok: true; config: MyNhdConfig } | { ok: false; reason: ConfigRefusal } {
  const secretKey = process.env.MYNHD_SECRET_KEY?.trim();
  if (!secretKey) return { ok: false, reason: 'no_secret' };

  const baseUrl = resolveBaseUrl();

  if (onProductionTarget() && baseUrl !== PRODUCTION_BASE_URL) {
    return { ok: false, reason: 'dev_url_on_production' };
  }

  return { ok: true, config: { baseUrl, secretKey } };
}

/** The config, or null. Kept for callers that only need "can we call at all". */
export function getConfig(): MyNhdConfig | null {
  const r = readConfig();
  return r.ok ? r.config : null;
}

export function configRefusalMessage(reason: ConfigRefusal): string {
  switch (reason) {
    case 'no_secret':
      return 'MyNHD is not configured (MYNHD_SECRET_KEY missing). No hazard preview was requested.';
    case 'dev_url_on_production':
      return 'MyNHD is pointed at a non-production host on the production deploy. '
        + 'No request was made: a development key and a production deploy must not be crossable. '
        + `Either unset MYNHD_BASE_URL on the production target, or set it to ${PRODUCTION_BASE_URL}.`;
  }
}

/**
 * The token, cached in module memory.
 *
 * SAME SHAPE AS SITEX, AND THE SAME LIMITATION: a serverless instance holds
 * this for as long as it lives, so the real hit rate is per-instance and a cold
 * start always authenticates. That is fine — one extra form POST — and it is
 * the reason this is not in the database. A shared token row would need its own
 * locking to avoid two instances refreshing at once, to save a call that costs
 * nothing.
 */
let cached: { token: string; expiresAt: number } | null = null;

/** Visible for tests. A module-level cache otherwise leaks between them. */
export function __resetTokenCacheForTests(): void {
  cached = null;
}

export class MyNhdAuthError extends Error {
  constructor(message: string, readonly httpStatus: number | null) {
    super(message);
    this.name = 'MyNhdAuthError';
  }
}

/**
 * A token, from cache when it is live.
 *
 * `force` skips the cache. That is the 401 + tryReAuth path: the token we hold
 * is not expired by our own clock but the vendor has rejected it, and asking
 * the cache again would hand back the same dead string forever.
 */
export async function getAccessToken(force = false): Promise<string> {
  const read = readConfig();
  if (!read.ok) {
    // The refusal reaches here too, not only the client's own early check: a
    // token request is a call to the vendor, and the crossing guard has to
    // cover every door rather than the one the client happens to use.
    throw new MyNhdAuthError(configRefusalMessage(read.reason), null);
  }
  const config = read.config;

  if (!force && cached && Date.now() < cached.expiresAt) return cached.token;

  // Form-encoded, NOT JSON. See the header.
  const response = await fetch(`${config.baseUrl}/getAuthorizationHeader`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({ secretkey: config.secretKey }).toString(),
    signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
  });

  const raw = await response.text();
  if (!response.ok) {
    // The body may name the problem; it may also echo nothing useful. Either
    // way it does NOT contain the secret, which was sent, not returned.
    throw new MyNhdAuthError(
      `MyNHD rejected the secret key (HTTP ${response.status}).`,
      response.status,
    );
  }

  let token: unknown;
  try {
    token = (JSON.parse(raw) as { token?: unknown }).token;
  } catch {
    throw new MyNhdAuthError('MyNHD returned a token response that was not JSON.', response.status);
  }

  if (typeof token !== 'string' || token.trim() === '') {
    throw new MyNhdAuthError('MyNHD returned no token.', response.status);
  }

  cached = { token, expiresAt: Date.now() + TOKEN_TTL_MS };
  return token;
}

/**
 * vendor_api_logs, same table and same row shape, under THIS vendor's name.
 *
 * NOT sitex/auth.ts's logRequest, which was the first thing written here. That
 * one hardcodes `vendor: 'sitex'` — so re-exporting it would have filed every
 * MyNHD call as a SiteX call, in the one table the usage view reads to say what
 * each vendor cost. A shared writer taking `vendor` as an argument would be
 * better than two copies, and is the right change to make when a third vendor
 * arrives; it is not worth editing a module that a dozen passing tests assert
 * against in order to save twenty lines today.
 *
 * Failures are swallowed, as they are on the SiteX side: a logging insert must
 * not be the thing that breaks a vendor call that otherwise worked.
 */
export async function logRequest(params: {
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
  } catch { /* A failed log must not fail the call it describes. */ }
}
