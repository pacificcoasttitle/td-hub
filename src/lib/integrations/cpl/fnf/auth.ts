import { db } from '@/lib/db/client';
import { vendorApiLogs, vendorTokens } from '@/lib/db/schema';
import { and, eq, gt } from 'drizzle-orm';

const VENDOR = 'fnf';
const TIMEOUT_MS = 20_000;

async function logAuthRequest(params: {
  operation: string; requestId: string; startedAt: Date;
  success: boolean; httpStatus?: number; errorCategory?: string;
  meta?: Record<string, unknown>;
}) {
  try {
    await db.insert(vendorApiLogs).values({
      vendor: VENDOR, operation: params.operation, orderId: null,
      requestId: params.requestId, startedAt: params.startedAt, endedAt: new Date(),
      success: params.success, httpStatus: params.httpStatus ?? null,
      errorCategory: params.errorCategory ?? null,
      requestMeta: params.meta ?? null, responseMeta: null,
    });
  } catch { /* logging must not break the main flow */ }
}

export async function getCachedToken(tokenType: string): Promise<string | null> {
  const rows = await db
    .select()
    .from(vendorTokens)
    .where(and(
      eq(vendorTokens.vendor, VENDOR),
      eq(vendorTokens.tokenType, tokenType),
      gt(vendorTokens.expiresAt, new Date()),
    ))
    .limit(1);
  return rows[0]?.token ?? null;
}

/**
 * Legacy: POST {FNF_VENDOR_URL}api/FnfAuthIdentityProvider/GetToken
 * Body: { clientId, secretKey }
 * Response field: jwtToken (not "token")
 */
export async function getVendorToken(cfg: {
  vendorUrl: string; clientId: string; secretKey: string;
}): Promise<string> {
  const cached = await getCachedToken('vendor_jwt');
  if (cached) return cached;

  const rid = `fnf-vendor-token-${crypto.randomUUID()}`;
  const startedAt = new Date();

  let res: Response;
  try {
    res = await fetch(`${cfg.vendorUrl}api/FnfAuthIdentityProvider/GetToken`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: cfg.clientId, secretKey: cfg.secretKey }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    await logAuthRequest({
      operation: 'get_vendor_token', requestId: rid, startedAt, success: false,
      errorCategory: 'NETWORK_ERROR', meta: { error: err instanceof Error ? err.message : 'fetch failed' },
    });
    throw new Error(`FNF vendor token fetch failed: ${err instanceof Error ? err.message : 'unknown'}`);
  }

  if (!res.ok) {
    await logAuthRequest({
      operation: 'get_vendor_token', requestId: rid, startedAt, success: false,
      httpStatus: res.status, errorCategory: 'AUTH_ERROR',
    });
    throw new Error(`FNF vendor token request failed: HTTP ${res.status}`);
  }

  const data = await res.json() as { jwtToken: string; expiresAt: string };
  const token = data.jwtToken;
  if (!token) throw new Error('FNF returned empty vendor token (no jwtToken field)');

  // Legacy uses expiresAt from response. Fallback to 8 hours (28800s) if missing.
  let expiresAt: Date;
  if (data.expiresAt) {
    expiresAt = new Date(data.expiresAt);
  } else {
    expiresAt = new Date(Date.now() + 28800 * 1000);
  }

  await db.insert(vendorTokens).values({ vendor: VENDOR, tokenType: 'vendor_jwt', token, expiresAt });
  await logAuthRequest({ operation: 'get_vendor_token', requestId: rid, startedAt, success: true, httpStatus: 200 });
  return token;
}

/**
 * Legacy: POST {FNF_USER_URL}userToken
 * Body: { accessToken: vendorToken, onBehalfOfUser }
 * Response field: user_token (not "userToken" or "token")
 */
export async function getUserToken(cfg: {
  userUrl: string; onBehalfOfUser: string;
}, vendorToken: string): Promise<string> {
  const cached = await getCachedToken('user_jwt');
  if (cached) return cached;

  const rid = `fnf-user-token-${crypto.randomUUID()}`;
  const startedAt = new Date();

  let res: Response;
  try {
    res = await fetch(`${cfg.userUrl}userToken`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${vendorToken}`,
      },
      body: JSON.stringify({ accessToken: vendorToken, onBehalfOfUser: cfg.onBehalfOfUser }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    await logAuthRequest({
      operation: 'get_user_token', requestId: rid, startedAt, success: false,
      errorCategory: 'NETWORK_ERROR', meta: { error: err instanceof Error ? err.message : 'fetch failed' },
    });
    throw new Error(`FNF user token fetch failed: ${err instanceof Error ? err.message : 'unknown'}`);
  }

  if (!res.ok) {
    await logAuthRequest({
      operation: 'get_user_token', requestId: rid, startedAt, success: false,
      httpStatus: res.status, errorCategory: 'AUTH_ERROR',
    });
    throw new Error(`FNF user token request failed: HTTP ${res.status}`);
  }

  const data = await res.json() as { user_token: string; expires_in: number; username: string };
  const token = data.user_token;
  if (!token) throw new Error('FNF returned empty user token (no user_token field)');

  const expiresAt = new Date(Date.now() + (data.expires_in ?? 3500) * 1000);
  await db.insert(vendorTokens).values({ vendor: VENDOR, tokenType: 'user_jwt', token, expiresAt });
  await logAuthRequest({ operation: 'get_user_token', requestId: rid, startedAt, success: true, httpStatus: 200 });
  return token;
}
