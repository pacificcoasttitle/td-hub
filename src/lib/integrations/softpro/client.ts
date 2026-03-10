import { VendorResult, VendorHealthResult, vendorSuccess, vendorError } from '../types';
import { SoftProResponse, SoftProOrderItem, SOFTPRO_ENDPOINTS } from './types';
import { db } from '@/lib/db/client';
import { vendorApiLogs } from '@/lib/db/schema';

const VENDOR = 'softpro';

function getBaseUrl(): string {
  const url = process.env.SOFTPRO_API_URL;
  if (!url) throw new Error('SOFTPRO_API_URL is not configured');
  return url.endsWith('/') ? url : url + '/';
}

async function logRequest(params: {
  operation: string;
  orderId?: number;
  requestId: string;
  startedAt: Date;
  endedAt?: Date;
  success?: boolean;
  httpStatus?: number;
  errorCategory?: string;
  requestMeta?: unknown;
  responseMeta?: unknown;
}) {
  try {
    await db.insert(vendorApiLogs).values({
      vendor: VENDOR,
      operation: params.operation,
      orderId: params.orderId ?? null,
      requestId: params.requestId,
      startedAt: params.startedAt,
      endedAt: params.endedAt ?? new Date(),
      success: params.success ?? null,
      httpStatus: params.httpStatus ?? null,
      errorCategory: params.errorCategory ?? null,
      requestMeta: params.requestMeta as Record<string, unknown> ?? null,
      responseMeta: params.responseMeta as Record<string, unknown> ?? null,
    });
  } catch {
    // Don't let logging failures break the main flow
  }
}

async function makeRequest<T>(
  method: 'GET' | 'POST',
  endpoint: string,
  options?: {
    queryParams?: Record<string, string>;
    body?: unknown;
    operation?: string;
    orderId?: number;
  }
): Promise<VendorResult<T>> {
  const requestId = crypto.randomUUID();
  const startedAt = new Date();
  const operation = options?.operation ?? endpoint;

  let url = getBaseUrl() + endpoint;
  if (method === 'GET' && options?.queryParams) {
    const params = new URLSearchParams(options.queryParams);
    url += '?' + params.toString();
  }

  try {
    const fetchOptions: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(60_000), // 60s timeout
    };

    if (method === 'POST' && options?.body) {
      fetchOptions.body = JSON.stringify(options.body);
    }

    const response = await fetch(url, fetchOptions);
    const raw = await response.json() as SoftProResponse<T>;

    const durationMs = Date.now() - startedAt.getTime();

    await logRequest({
      operation,
      orderId: options?.orderId,
      requestId,
      startedAt,
      success: raw.Status === 200,
      httpStatus: response.status,
      requestMeta: { url, method, queryParams: options?.queryParams },
      responseMeta: { status: raw.Status, message: raw.Message },
    });

    if (raw.Status === 200) {
      return vendorSuccess(raw.data as T, { requestId, durationMs });
    }

    return vendorError<T>(VENDOR, 'API_ERROR', raw.Message ?? 'Unknown SoftPro error', {
      httpStatus: response.status,
      requestId,
      durationMs,
    });
  } catch (err) {
    const durationMs = Date.now() - startedAt.getTime();
    const message = err instanceof Error ? err.message : 'Unknown error';

    await logRequest({
      operation,
      orderId: options?.orderId,
      requestId,
      startedAt,
      success: false,
      errorCategory: 'NETWORK',
      requestMeta: { url, method },
      responseMeta: { error: message },
    });

    return vendorError<T>(VENDOR, 'NETWORK_ERROR', message, {
      retryable: true,
      requestId,
      durationMs,
    });
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function getOrderDetails(params: {
  dateFrom?: string;
  dateTo?: string;
  orderNumber?: string;
}): Promise<VendorResult<SoftProOrderItem[]>> {
  const queryParams: Record<string, string> = {};
  if (params.dateFrom) queryParams.DateFrom = params.dateFrom;
  if (params.dateTo) queryParams.DateTo = params.dateTo;
  if (params.orderNumber) queryParams.OrderNumber = params.orderNumber;

  return makeRequest<SoftProOrderItem[]>('GET', SOFTPRO_ENDPOINTS.getOrderDetails, {
    queryParams,
    operation: 'get_order_details',
  });
}

export async function getOrderStatuses(params: {
  dateFrom: string;
  dateTo: string;
}): Promise<VendorResult<SoftProOrderItem[]>> {
  return makeRequest<SoftProOrderItem[]>('GET', SOFTPRO_ENDPOINTS.getOrders, {
    queryParams: { DateFrom: params.dateFrom, DateTo: params.dateTo },
    operation: 'get_order_statuses',
  });
}

export async function uploadDocument(params: {
  orderNumber: string;
  documentName: string;
  folderName: string;
  fileUrl: string;
}): Promise<VendorResult<{ documentId: string }>> {
  const body = [{
    OrderNumber: params.orderNumber,
    DocumentName: params.documentName,
    FileList: [{ FolderName: params.folderName, FileURL: params.fileUrl }],
  }];

  return makeRequest<{ documentId: string }>('POST', SOFTPRO_ENDPOINTS.uploadDocument, {
    body,
    operation: 'upload_document',
  });
}

export async function healthCheck(): Promise<VendorHealthResult> {
  const start = Date.now();
  try {
    const url = getBaseUrl();
    const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    return {
      healthy: response.ok,
      vendor: VENDOR,
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    return {
      healthy: false,
      vendor: VENDOR,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}
