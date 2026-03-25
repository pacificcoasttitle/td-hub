import { db } from '@/lib/db/client';
import { vendorApiLogs, vendorTokens } from '@/lib/db/schema';
import { and, eq, gt } from 'drizzle-orm';
import type { CplBranch } from '../types';

const VENDOR = 'westcor';
const TIMEOUT_MS = 15_000;

export interface WestcorGroup {
  id?: number;
  name?: string;
  agencyName?: string;
  agentNumber?: string;
  address?: string;
  address1?: string;
  city?: string;
  state?: string;
  zip?: string;
  phone?: string;
  agencyNumber?: string;
}

export let cachedGroups: WestcorGroup[] | null = null;

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

export async function getCachedToken(): Promise<string | null> {
  const rows = await db
    .select()
    .from(vendorTokens)
    .where(and(
      eq(vendorTokens.vendor, VENDOR),
      eq(vendorTokens.tokenType, 'bearer'),
      gt(vendorTokens.expiresAt, new Date()),
    ))
    .limit(1);
  return rows[0]?.token ?? null;
}

export async function getToken(cfg: {
  baseUrl: string; username: string; password: string; integrationPartner: string;
}): Promise<string> {
  const cached = await getCachedToken();
  if (cached) return cached;

  const rid = `westcor-token-${crypto.randomUUID()}`;
  const startedAt = new Date();

  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl}Token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        username: cfg.username,
        password: cfg.password,
        integrationpartner: cfg.integrationPartner,
      }).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'fetch failed';
    await logAuthRequest({ operation: 'get_token', requestId: rid, startedAt, success: false, errorCategory: 'NETWORK_ERROR', meta: { error: msg, url: `${cfg.baseUrl}Token` } });
    throw new Error(`Westcor token fetch failed: ${msg}`);
  }

  if (!res.ok) {
    await logAuthRequest({ operation: 'get_token', requestId: rid, startedAt, success: false, httpStatus: res.status, errorCategory: 'AUTH_ERROR' });
    throw new Error(`Westcor token request failed: HTTP ${res.status}`);
  }

  const data = await res.json() as {
    access_token: string;
    expires_in?: number;
    groups?: WestcorGroup[] | string;
  };

  const token = data.access_token;
  const expiresInSec = data.expires_in ?? 36_000;
  const expiresAt = new Date(Date.now() + (expiresInSec - 120) * 1000);

  let groups: WestcorGroup[] = [];
  if (typeof data.groups === 'string') {
    try { groups = JSON.parse(data.groups); } catch { /* ignore parse errors */ }
  } else if (Array.isArray(data.groups)) {
    groups = data.groups;
  }

  if (groups.length > 0) {
    cachedGroups = groups;
  }

  await db.insert(vendorTokens).values({
    vendor: VENDOR, tokenType: 'bearer', token, expiresAt,
    metadata: groups.length > 0 ? { groups } : null,
  });

  await logAuthRequest({ operation: 'get_token', requestId: rid, startedAt, success: true, httpStatus: 200, meta: { groupCount: groups.length } });
  return token;
}

export function mapGroupsToBranches(groups: WestcorGroup[]): CplBranch[] {
  return groups.map((g) => ({
    branchCode: g.agentNumber ?? g.agencyNumber ?? String(g.id ?? ''),
    branchName: g.agencyName ?? g.name ?? '',
    agencyName: g.agencyName ?? g.name,
    address: g.address ?? g.address1,
    city: g.city,
    state: g.state,
    zip: g.zip,
    phone: g.phone,
    underwriterCode: g.agentNumber ?? g.agencyNumber,
  }));
}
