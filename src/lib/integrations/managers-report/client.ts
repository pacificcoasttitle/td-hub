import { VendorResult, VendorHealthResult, vendorSuccess, vendorError } from '../types';
import { db } from '@/lib/db/client';
import { vendorApiLogs } from '@/lib/db/schema';
import type { RepFigures, LeaderboardResponse, ClosingsResponse, ProductionHistoryResponse, TrendsResponse, ClientSummaryResponse } from './types';

const VENDOR = 'managers_report';
const TIMEOUT_MS = 15_000;

function getConfig() {
  const baseUrl = process.env.MANAGERS_REPORT_API_URL;
  if (!baseUrl) return null;
  return {
    baseUrl: baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl,
    apiKey: process.env.MANAGERS_REPORT_API_KEY ?? '',
  };
}

async function logRequest(params: {
  operation: string; requestId: string; startedAt: Date;
  success: boolean; httpStatus?: number; durationMs: number;
  requestMeta?: Record<string, unknown>; responseMeta?: Record<string, unknown>;
}) {
  try {
    await db.insert(vendorApiLogs).values({
      vendor: VENDOR,
      operation: params.operation,
      requestId: params.requestId,
      startedAt: params.startedAt,
      endedAt: new Date(),
      success: params.success,
      httpStatus: params.httpStatus ?? null,
      errorCategory: params.success ? null : 'API_ERROR',
      requestMeta: params.requestMeta ?? null,
      responseMeta: params.responseMeta ?? null,
    });
  } catch { /* logging must not break the main flow */ }
}

async function makeRequest<T>(
  path: string,
  operation: string,
  queryParams?: Record<string, string>,
): Promise<VendorResult<T>> {
  const config = getConfig();
  if (!config) return vendorError<T>(VENDOR, 'NOT_CONFIGURED', 'MANAGERS_REPORT_API_URL is not set');

  const requestId = crypto.randomUUID();
  const startedAt = new Date();
  let url = `${config.baseUrl}${path}`;
  if (queryParams) {
    const filtered = Object.fromEntries(Object.entries(queryParams).filter(([, v]) => v !== undefined && v !== ''));
    if (Object.keys(filtered).length > 0) url += '?' + new URLSearchParams(filtered).toString();
  }

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (config.apiKey) headers['x-api-key'] = config.apiKey;

    const response = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const durationMs = Date.now() - startedAt.getTime();

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      await logRequest({ operation, requestId, startedAt, success: false, httpStatus: response.status, durationMs, requestMeta: { url }, responseMeta: { body: text.slice(0, 500) } });
      return vendorError<T>(VENDOR, 'HTTP_ERROR', `HTTP ${response.status}: ${text.slice(0, 200)}`, { httpStatus: response.status, requestId, durationMs, retryable: response.status >= 500 });
    }

    const data = (await response.json()) as T;
    await logRequest({ operation, requestId, startedAt, success: true, httpStatus: response.status, durationMs, requestMeta: { url } });
    return vendorSuccess(data, { requestId, durationMs });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const durationMs = Date.now() - startedAt.getTime();
    await logRequest({ operation, requestId, startedAt, success: false, durationMs, requestMeta: { url }, responseMeta: { error: message } });
    return vendorError<T>(VENDOR, 'NETWORK_ERROR', message, { retryable: true, requestId, durationMs });
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

export async function getRepFigures(
  repName: string,
  month?: string,
): Promise<VendorResult<RepFigures>> {
  const params: Record<string, string> = {};
  if (month) params.month = month;
  return makeRequest<RepFigures>(`/api/td/rep/${encodeURIComponent(repName)}`, 'get_rep_figures', params);
}

export async function getLeaderboard(
  month?: string,
  limit?: number,
): Promise<VendorResult<LeaderboardResponse>> {
  const params: Record<string, string> = {};
  if (month) params.month = month;
  if (limit) params.limit = String(limit);
  return makeRequest<LeaderboardResponse>('/api/td/leaderboard', 'get_leaderboard', params);
}

export async function getClosings(
  month?: number,
  year?: number,
  repName?: string,
): Promise<VendorResult<ClosingsResponse>> {
  const params: Record<string, string> = {};
  if (month) params.month = String(month);
  if (year) params.year = String(year);
  if (repName) params.repName = repName;
  return makeRequest<ClosingsResponse>('/api/td/closings', 'get_closings', params);
}

export async function getProductionHistory(
  year?: number,
  repName?: string,
): Promise<VendorResult<ProductionHistoryResponse>> {
  const params: Record<string, string> = {};
  if (year) params.year = String(year);
  if (repName) params.repName = repName;
  return makeRequest<ProductionHistoryResponse>('/api/td/production-history', 'get_production_history', params);
}

export async function getTrends(
  repName?: string,
): Promise<VendorResult<TrendsResponse>> {
  const params: Record<string, string> = {};
  if (repName) params.repName = repName;
  return makeRequest<TrendsResponse>('/api/td/trends', 'get_trends', params);
}

export async function getClientSummary(
  year: number,
  repName?: string,
): Promise<VendorResult<ClientSummaryResponse>> {
  const params: Record<string, string> = { year: String(year) };
  if (repName) params.repName = repName;
  return makeRequest<ClientSummaryResponse>('/api/td/client-summary', 'get_client_summary', params);
}

export async function healthCheck(): Promise<VendorHealthResult> {
  const start = Date.now();
  const config = getConfig();
  if (!config) return { healthy: false, vendor: VENDOR, latencyMs: 0, error: 'Not configured' };

  try {
    const response = await fetch(`${config.baseUrl}/api/td/ping`, {
      headers: config.apiKey ? { 'x-api-key': config.apiKey } : {},
      signal: AbortSignal.timeout(5_000),
    });
    return { healthy: response.ok, vendor: VENDOR, latencyMs: Date.now() - start };
  } catch (err) {
    return { healthy: false, vendor: VENDOR, latencyMs: Date.now() - start, error: err instanceof Error ? err.message : 'Unknown' };
  }
}
