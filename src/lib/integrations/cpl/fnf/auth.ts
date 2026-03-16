import { db } from '@/lib/db/client';
import { vendorApiLogs, vendorTokens } from '@/lib/db/schema';
import { and, eq, gt } from 'drizzle-orm';

const VENDOR = 'fnf';
const TIMEOUT_MS = 20_000;

async function logAuthRequest(params: {
  operation: string; requestId: string; startedAt: Date;
  success: boolean; httpStatus?: number; errorCategory?: string;
}) {
  try {
    await db.insert(vendorApiLogs).values({
      vendor: VENDOR, operation: params.operation, orderId: null,
      requestId: params.requestId, startedAt: params.startedAt, endedAt: new Date(),
      success: params.success, httpStatus: params.httpStatus ?? null,
      errorCategory: params.errorCategory ?? null,
      requestMeta: null, responseMeta: null,
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

export async function getVendorToken(cfg: {
  vendorUrl: string; clientId: string; secretKey: string;
}): Promise<string> {
  const cached = await getCachedToken('vendor_jwt');
  if (cached) return cached;

  const rid = `fnf-vendor-token-${crypto.randomUUID()}`;
  const startedAt = new Date();

  const res = await fetch(`${cfg.vendorUrl}api/FnfAuthIdentityProvider/GetToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: cfg.clientId, secretKey: cfg.secretKey }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    await logAuthRequest({ operation: 'get_vendor_token', requestId: rid, startedAt, success: false, httpStatus: res.status, errorCategory: 'AUTH_ERROR' });
    throw new Error(`FNF vendor token request failed: HTTP ${res.status}`);
  }

  const data = await res.json() as { jwtToken?: string; token?: string; expiresIn?: number };
  const token = data.jwtToken ?? data.token ?? '';
  if (!token) throw new Error('FNF returned empty vendor token');

  const expiresAt = new Date(Date.now() + (data.expiresIn ?? 3500) * 1000);
  await db.insert(vendorTokens).values({ vendor: VENDOR, tokenType: 'vendor_jwt', token, expiresAt });
  await logAuthRequest({ operation: 'get_vendor_token', requestId: rid, startedAt, success: true, httpStatus: 200 });
  return token;
}

export async function getUserToken(cfg: {
  userUrl: string; onBehalfOfUser: string;
}, vendorToken: string): Promise<string> {
  const cached = await getCachedToken('user_jwt');
  if (cached) return cached;

  const rid = `fnf-user-token-${crypto.randomUUID()}`;
  const startedAt = new Date();

  const res = await fetch(`${cfg.userUrl}userToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken: vendorToken, onBehalfOfUser: cfg.onBehalfOfUser }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    await logAuthRequest({ operation: 'get_user_token', requestId: rid, startedAt, success: false, httpStatus: res.status, errorCategory: 'AUTH_ERROR' });
    throw new Error(`FNF user token request failed: HTTP ${res.status}`);
  }

  const data = await res.json() as { user_token?: string; userToken?: string; token?: string; expiresIn?: number };
  const token = data.user_token ?? data.userToken ?? data.token ?? '';
  if (!token) throw new Error('FNF returned empty user token');

  const expiresAt = new Date(Date.now() + (data.expiresIn ?? 3500) * 1000);
  await db.insert(vendorTokens).values({ vendor: VENDOR, tokenType: 'user_jwt', token, expiresAt });
  await logAuthRequest({ operation: 'get_user_token', requestId: rid, startedAt, success: true, httpStatus: 200 });
  return token;
}
