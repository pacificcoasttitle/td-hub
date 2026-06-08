import { VendorResult, VendorHealthResult, vendorSuccess, vendorError } from '../types';
import {
  SoftProResponse,
  SoftProOrderItem,
  SoftProOrderDetailItem,
  SoftProLookupItem,
  SoftProOrderContactsData,
  SoftProAttachedDocument,
  SoftProFeeResponse,
  SOFTPRO_ENDPOINTS,
} from './types';
import {
  categorizeSoftProResponse,
  isRetryableSoftProError,
  softProCategoryToErrorCode,
} from './error-category';
import {
  addSoftProUserIdToRecord,
  addSoftProUserIdToWritePayload,
  buildSoftProHeaders,
  generateSoftProToken,
  getSoftProUserId,
  type RegisterSoftProTokenParams,
  type RegisterSoftProTokenResult,
  type SoftProUserContext,
} from './auth';
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
  retryable?: boolean;
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
      retryable: params.retryable ?? false,
      httpStatus: params.httpStatus ?? null,
      errorCategory: params.errorCategory ?? null,
      requestMeta: params.requestMeta as Record<string, unknown> ?? null,
      responseMeta: params.responseMeta as Record<string, unknown> ?? null,
    });
  } catch {
    // Don't let logging failures break the main flow
  }
}

function buildSuccessResponseMeta<T>(operation: string, raw: SoftProResponse<T>): Record<string, unknown> {
  const meta: Record<string, unknown> = {
    status: raw.Status,
    bodyStatus: raw.Status,
    message: raw.Message,
  };

  if (operation === 'get_order_details' && Array.isArray(raw.data)) {
    const escrowOfficerValues = raw.data
      .map((item) => (item as Partial<SoftProOrderDetailItem>).EscrowOfficer)
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .map((value) => value.trim());

    meta.resultCount = raw.data.length;
    meta.escrowOfficerCount = escrowOfficerValues.length;
    // SoftPro GetOrderDetails is the canonical source for the internal PCT escrow officer.
    meta.sampleEscrowOfficers = Array.from(new Set(escrowOfficerValues)).slice(0, 5);
  }

  return meta;
}

async function makeRequest<T>(
  method: 'GET' | 'POST',
  endpoint: string,
  options?: {
    queryParams?: Record<string, string>;
    body?: unknown;
    operation?: string;
    orderId?: number;
    timeoutMs?: number;
    userContext?: SoftProUserContext;
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
    const isWrite = method === 'POST';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...buildSoftProHeaders({ requireToken: isWrite }),
    };
    const body = isWrite && options?.body
      ? addSoftProUserIdToWritePayload(options.body, options.userContext)
      : options?.body;

    const fetchOptions: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(options?.timeoutMs ?? 60_000),
    };

    if (method === 'POST' && body) {
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(url, fetchOptions);

    let raw: SoftProResponse<T>;
    let rawText: string | undefined;
    try {
      rawText = await response.text();
      raw = JSON.parse(rawText) as SoftProResponse<T>;
    } catch {
      const durationMs = Date.now() - startedAt.getTime();
      const category = categorizeSoftProResponse({
        httpStatus: response.status,
        message: rawText,
      });
      const retryable = isRetryableSoftProError(category);
      await logRequest({
        operation,
        orderId: options?.orderId,
        requestId,
        startedAt,
        success: false,
        httpStatus: response.status,
        retryable,
        errorCategory: category,
        requestMeta: { url, method, ...(body ? { payload: body } : { queryParams: options?.queryParams }) },
        responseMeta: { bodyStatus: null, rawSnippet: (rawText ?? '').slice(0, 500) },
      });
      return vendorError<T>(VENDOR, softProCategoryToErrorCode(category), `Non-JSON response (HTTP ${response.status}): ${(rawText ?? '').slice(0, 200)}`, {
        httpStatus: response.status, requestId, durationMs, retryable,
      });
    }

    const durationMs = Date.now() - startedAt.getTime();
    const success = raw.Status === 200 && response.status < 400;
    const category = categorizeSoftProResponse({
      bodyStatus: raw.Status,
      httpStatus: response.status,
      message: raw.Message,
    });
    const retryable = isRetryableSoftProError(category);

    await logRequest({
      operation,
      orderId: options?.orderId,
      requestId,
      startedAt,
      success,
      httpStatus: response.status,
      retryable: success ? false : retryable,
      errorCategory: success ? undefined : category,
      requestMeta: { url, method, ...(body ? { payload: body } : { queryParams: options?.queryParams }) },
      responseMeta: success
        ? buildSuccessResponseMeta(operation, raw)
        : { status: raw.Status, bodyStatus: raw.Status, message: raw.Message, rawBody: raw },
    });

    if (success) {
      return vendorSuccess(raw.data as T, { requestId, durationMs });
    }

    const errorMsg = raw.Message
      || (typeof raw === 'object' ? JSON.stringify(raw).slice(0, 300) : String(raw))
      || 'Unknown SoftPro error';
    return vendorError<T>(VENDOR, softProCategoryToErrorCode(category), errorMsg, {
      httpStatus: response.status,
      requestId,
      durationMs,
      retryable,
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
      retryable: true,
      errorCategory: 'unknown',
      requestMeta: { url, method, ...(options?.body ? { payload: options.body } : {}) },
      responseMeta: { bodyStatus: null, error: message },
    });

    return vendorError<T>(VENDOR, 'NETWORK_ERROR', message, {
      retryable: true,
      requestId,
      durationMs,
    });
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function createOrder(
  payload: Record<string, unknown>
): Promise<VendorResult<{ orderNumber: string }>> {
  const requestId = crypto.randomUUID();
  const startedAt = new Date();
  const url = getBaseUrl() + SOFTPRO_ENDPOINTS.createOrder;

  try {
    const payloadWithUserId = addSoftProUserIdToRecord(payload);
    const hdrs: Record<string, string> = {
      'Content-Type': 'application/json',
      ...buildSoftProHeaders({ requireToken: true }),
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: hdrs,
      body: JSON.stringify(payloadWithUserId),
      signal: AbortSignal.timeout(60_000),
    });

    const raw = (await response.json()) as SoftProResponse & { OrderNumber?: string };
    const durationMs = Date.now() - startedAt.getTime();

    await logRequest({
      operation: 'create_order', requestId, startedAt,
      success: raw.Status === 200,
      httpStatus: response.status,
      requestMeta: { url, method: 'POST', payload: payloadWithUserId },
      responseMeta: raw.Status === 200
        ? { status: raw.Status, message: raw.Message, orderNumber: raw.OrderNumber }
        : { status: raw.Status, message: raw.Message, rawBody: raw },
    });

    if (raw.Status === 200 && raw.OrderNumber) {
      return vendorSuccess({ orderNumber: raw.OrderNumber }, { requestId, durationMs });
    }

    return vendorError<{ orderNumber: string }>(VENDOR, 'CREATE_FAILED',
      raw.Message ?? 'Failed to create order', { httpStatus: response.status, requestId, durationMs });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const durationMs = Date.now() - startedAt.getTime();

    await logRequest({
      operation: 'create_order', requestId, startedAt,
      success: false, errorCategory: 'NETWORK',
      requestMeta: { url, method: 'POST' },
      responseMeta: { error: message },
    });

    return vendorError<{ orderNumber: string }>(VENDOR, 'NETWORK_ERROR', message, {
      retryable: true, requestId, durationMs,
    });
  }
}

export async function registerSoftProToken(
  params: RegisterSoftProTokenParams = {},
): Promise<VendorResult<RegisterSoftProTokenResult>> {
  const requestId = crypto.randomUUID();
  const startedAt = new Date();
  const url = getBaseUrl() + SOFTPRO_ENDPOINTS.createUserToken;
  const userId = params.userId?.trim() || getSoftProUserId();
  const token = params.token?.trim() || generateSoftProToken();
  const tokenStatus = params.tokenStatus ?? 1;
  const payload = { UserId: userId, Token: token, TokenStatus: tokenStatus };
  const loggedPayload = { ...payload, Token: '[redacted]' };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });

    let raw: SoftProResponse<unknown>;
    let rawText: string | undefined;
    try {
      rawText = await response.text();
      raw = JSON.parse(rawText) as SoftProResponse<unknown>;
    } catch {
      const durationMs = Date.now() - startedAt.getTime();
      await logRequest({
        operation: 'create_user_token',
        requestId,
        startedAt,
        success: false,
        httpStatus: response.status,
        retryable: response.status >= 500,
        errorCategory: response.status === 401 ? 'auth' : 'unknown',
        requestMeta: { url, method: 'POST', payload: loggedPayload },
        responseMeta: { bodyStatus: null, rawSnippet: (rawText ?? '').slice(0, 500) },
      });
      return vendorError<RegisterSoftProTokenResult>(
        VENDOR,
        response.status === 401 ? 'AUTH' : 'UNKNOWN',
        `Non-JSON response (HTTP ${response.status}): ${(rawText ?? '').slice(0, 200)}`,
        { httpStatus: response.status, requestId, durationMs, retryable: response.status >= 500 },
      );
    }

    const durationMs = Date.now() - startedAt.getTime();
    const success = raw.Status === 200 && response.status < 400;
    const category = categorizeSoftProResponse({
      bodyStatus: raw.Status,
      httpStatus: response.status,
      message: raw.Message,
    });
    const retryable = isRetryableSoftProError(category);

    await logRequest({
      operation: 'create_user_token',
      requestId,
      startedAt,
      success,
      httpStatus: response.status,
      retryable: success ? false : retryable,
      errorCategory: success ? undefined : category,
      requestMeta: { url, method: 'POST', payload: loggedPayload },
      responseMeta: { status: raw.Status, bodyStatus: raw.Status, message: raw.Message },
    });

    if (success) {
      return vendorSuccess({ userId, token, tokenStatus }, { requestId, durationMs });
    }

    return vendorError<RegisterSoftProTokenResult>(
      VENDOR,
      softProCategoryToErrorCode(category),
      raw.Message || 'SoftPro token registration failed',
      { httpStatus: response.status, requestId, durationMs, retryable },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const durationMs = Date.now() - startedAt.getTime();

    await logRequest({
      operation: 'create_user_token',
      requestId,
      startedAt,
      success: false,
      retryable: true,
      errorCategory: 'unknown',
      requestMeta: { url, method: 'POST', payload: loggedPayload },
      responseMeta: { bodyStatus: null, error: message },
    });

    return vendorError<RegisterSoftProTokenResult>(VENDOR, 'NETWORK_ERROR', message, {
      retryable: true,
      requestId,
      durationMs,
    });
  }
}

export async function getOrders(params: {
  dateFrom: string;
  dateTo: string;
}): Promise<VendorResult<SoftProOrderItem[]>> {
  return makeRequest<SoftProOrderItem[]>('GET', SOFTPRO_ENDPOINTS.getOrders, {
    queryParams: { DateFrom: params.dateFrom, DateTo: params.dateTo },
    operation: 'get_orders',
  });
}

export async function getOrderDetails(params: {
  dateFrom: string;
  dateTo?: string;
  orderNumber?: string;
  orderId?: number;
}): Promise<VendorResult<SoftProOrderDetailItem[]>> {
  return makeRequest<SoftProOrderDetailItem[]>('GET', SOFTPRO_ENDPOINTS.getOrderDetails, {
    queryParams: {
      DateFrom: params.dateFrom,
      DateTo: params.dateTo ?? '',
      OrderNumber: params.orderNumber ?? '',
    },
    operation: 'get_order_details',
    orderId: params.orderId,
    timeoutMs: 120_000,
  });
}

export async function getOrderContacts(
  orderNumber: string
): Promise<VendorResult<SoftProOrderContactsData>> {
  return makeRequest<SoftProOrderContactsData>('GET', SOFTPRO_ENDPOINTS.getOrderContacts, {
    queryParams: { OrderNumber: orderNumber },
    operation: 'get_order_contacts',
  });
}

export async function getAttachedDocuments(
  orderNumber: string
): Promise<VendorResult<SoftProAttachedDocument[]>> {
  return makeRequest<SoftProAttachedDocument[]>('GET', SOFTPRO_ENDPOINTS.getAttachedDocuments, {
    queryParams: { orderNumber },
    operation: 'get_attached_documents',
  });
}

export async function uploadDocument(params: {
  documentId: number;
  orderNumber: string;
  documentName: string;
  folderName: string;
  fileUrl: string;
}): Promise<VendorResult<{ documentId: string }>> {
  // Legacy payload shape: array with Id, OrderNumber, DocumentName, FileList
  const body = [{
    Id: String(params.documentId),
    OrderNumber: params.orderNumber,
    DocumentName: params.documentName,
    FileList: [{ FolderName: params.folderName, FileURL: params.fileUrl }],
  }];

  return makeRequest<{ documentId: string }>('POST', SOFTPRO_ENDPOINTS.uploadDocument, {
    body,
    operation: 'upload_document',
    orderId: undefined,
  });
}

export async function getLookupTable(
  userType: string
): Promise<VendorResult<SoftProLookupItem[]>> {
  return makeRequest<SoftProLookupItem[]>('GET', SOFTPRO_ENDPOINTS.getLookupTable, {
    queryParams: { userType },
    operation: 'get_lookup_table',
  });
}

export async function addNotes(
  orderNumber: string,
  text: string,
  noteId?: string,
): Promise<VendorResult<{ success: boolean }>> {
  const body = [{
    OrderNumber: orderNumber,
    Text: text,
    ...(noteId ? { Id: noteId } : {}),
  }];

  return makeRequest<{ success: boolean }>('POST', SOFTPRO_ENDPOINTS.addNote, {
    body,
    operation: 'add_notes',
  });
}

export async function getFees(
  orderNumber: string,
): Promise<VendorResult<SoftProFeeResponse>> {
  return makeRequest<SoftProFeeResponse>('GET', SOFTPRO_ENDPOINTS.getFees, {
    queryParams: { orderNumber },
    operation: 'get_fees',
  });
}

export async function getSalesReps(): Promise<VendorResult<SoftProLookupItem[]>> {
  return makeRequest<SoftProLookupItem[]>('GET', SOFTPRO_ENDPOINTS.getSalesReps, {
    operation: 'get_sales_reps',
    timeoutMs: 180_000,
  });
}

export async function createUser(
  payload: Record<string, unknown>
): Promise<VendorResult<Record<string, unknown>>> {
  return makeRequest<Record<string, unknown>>('POST', SOFTPRO_ENDPOINTS.createUser, {
    body: payload,
    operation: 'create_user',
  });
}

export async function updateUser(
  payload: Record<string, unknown>
): Promise<VendorResult<Record<string, unknown>>> {
  return makeRequest<Record<string, unknown>>('POST', SOFTPRO_ENDPOINTS.updateUser, {
    body: payload,
    operation: 'update_user',
  });
}

export async function addCompany(
  payload: Record<string, unknown>
): Promise<VendorResult<Record<string, unknown>>> {
  return makeRequest<Record<string, unknown>>('POST', SOFTPRO_ENDPOINTS.addCompany, {
    body: payload,
    operation: 'add_company',
  });
}

export async function updateCompany(
  payload: Record<string, unknown>
): Promise<VendorResult<Record<string, unknown>>> {
  return makeRequest<Record<string, unknown>>('POST', SOFTPRO_ENDPOINTS.updateCompany, {
    body: payload,
    operation: 'update_company',
  });
}

export async function getOrderStatusList(): Promise<VendorResult<string[]>> {
  return makeRequest<string[]>('GET', SOFTPRO_ENDPOINTS.getOrderStatus, {
    operation: 'get_order_status',
  });
}

export async function healthCheck(): Promise<VendorHealthResult> {
  const start = Date.now();
  try {
    const url = getBaseUrl();
    const response = await fetch(url, {
      headers: buildSoftProHeaders(),
      signal: AbortSignal.timeout(5_000),
    });
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
