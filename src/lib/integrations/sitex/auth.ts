import { db } from '@/lib/db/client';
import { vendorApiLogs } from '@/lib/db/schema';
import type { SiteXTokenResponse } from './types';

export const VENDOR = 'sitex';
export const TOKEN_BUFFER_MS = 60_000;
export const TIMEOUT_MS = 30_000;

export function getConfig() {
  const baseUrl = process.env.SITEX_BASE_URL;
  if (!baseUrl) return null;
  return {
    baseUrl: baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl,
    clientId: process.env.SITEX_CLIENT_ID ?? '',
    clientSecret: process.env.SITEX_CLIENT_SECRET ?? '',
    feedId: process.env.SITEX_FEED_ID ?? '',
  };
}

let cachedToken: { token: string; expiresAt: number } | null = null;

export async function getAccessToken(baseUrl: string, clientId: string, clientSecret: string): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }

  const tokenUrl = `${baseUrl}/ls/apigwy/oauth2/v1/token`;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`Token request failed: HTTP ${response.status}`);
  }

  const data = (await response.json()) as SiteXTokenResponse;

  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in * 1000) - TOKEN_BUFFER_MS,
  };

  return cachedToken.token;
}

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
  } catch { /* Don't let logging failures break the main flow */ }
}
