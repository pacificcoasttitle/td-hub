import { VendorResult, VendorHealthResult, vendorSuccess, vendorError } from '../types';
import {
  SoftProResponse,
  SoftProOrderItem,
  SoftProOrderDetailItem,
  SoftProLookupItem,
  SoftProLookupTablePage,
  SoftProLookupTableRequest,
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
  describeSuspectedTruncation,
  isSuspectedTruncation,
  SOFTPRO_SEARCH_ROW_CAP,
} from './vendor-limits';
import {
  addSoftProUserIdToRecord,
  addSoftProUserIdToWritePayload,
  buildSoftProHeaders,
  generateSoftProToken,
  getSoftProUserId,
  redactSoftProAuthFields,
  SoftProConfigError,
  type RegisterSoftProTokenParams,
  type RegisterSoftProTokenResult,
  type SoftProUserContext,
} from './auth';
import { db } from '@/lib/db/client';
import { vendorApiLogs } from '@/lib/db/schema';

const VENDOR = 'softpro';

type SoftProArrayEnvelopeItem = {
  Status?: number;
  Message?: string;
  FileUploadedStatus?: boolean;
  OrderNumber?: string;
  Id?: string;
};

type SoftProArrayEnvelopeEvaluation = {
  success: boolean;
  category: ReturnType<typeof categorizeSoftProResponse>;
  retryable: boolean;
  message: string;
  itemCount: number;
  failedCount: number;
  items: SoftProArrayEnvelopeItem[];
  failedItems: Array<SoftProArrayEnvelopeItem & { index: number }>;
};

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

/**
 * GetAttachedDocuments is the only read whose body we keep. The prelim parser
 * accepts bare URL strings and drops everything else, so an empty response and
 * a shape we can't read are indistinguishable from the log — which is why
 * 410 Title & Escrow orders with no prelim could not be explained. `keys`
 * exposes FolderName if the vendor sends it.
 */
export function describeAttachedDocuments(data: unknown): Record<string, unknown> {
  if (!Array.isArray(data)) {
    return { dataType: data === null ? 'null' : typeof data, itemCount: 0 };
  }

  const keys = new Set<string>();
  const itemTypes = new Set<string>();
  for (const item of data) {
    if (item !== null && typeof item === 'object') {
      itemTypes.add('object');
      for (const k of Object.keys(item as Record<string, unknown>)) keys.add(k);
    } else {
      itemTypes.add(item === null ? 'null' : typeof item);
    }
  }

  return {
    dataType: 'array',
    itemCount: data.length,
    itemTypes: Array.from(itemTypes),
    keys: Array.from(keys),
    // What extractUrls in fetch-prelims would actually keep.
    urlCount: data.filter((i) => typeof i === 'string' && i.startsWith('http')).length,
    sample: data.slice(0, 3).map((i) => JSON.stringify(i)?.slice(0, 300) ?? String(i)),
  };
}

function buildSuccessResponseMeta<T>(
  operation: string,
  raw: SoftProResponse<T>,
  requestMeta?: Record<string, string>,
): Record<string, unknown> {
  const meta: Record<string, unknown> = {
    status: raw.Status,
    bodyStatus: raw.Status,
    message: raw.Message,
  };

  if (operation === 'get_attached_documents' || operation === 'get_attached_documents_prelim') {
    meta.attached = describeAttachedDocuments(raw.data);
  }

  // Recorded HERE rather than in the sync handler so the count is captured for
  // EVERY GetOrders caller — the hourly sync, the ingest gap detector, and any
  // one-off audit script — without each of them having to remember. Until this
  // existed, `vendor_api_logs` held 3,635 successful get_orders rows and not one
  // of them recorded how many orders came back, so the question "has the cap
  // already truncated us?" could not be answered from history at all.
  if (operation === 'get_orders' && Array.isArray(raw.data)) {
    const resultCount = raw.data.length;
    meta.resultCount = resultCount;
    meta.vendorRowCap = SOFTPRO_SEARCH_ROW_CAP;
    meta.truncationSuspected = isSuspectedTruncation(resultCount);
    if (meta.truncationSuspected) {
      meta.truncationNote = describeSuspectedTruncation({
        operation: 'GetOrders',
        dateFrom: String(requestMeta?.DateFrom ?? ''),
        dateTo: String(requestMeta?.DateTo ?? ''),
        rowCount: resultCount,
      });
    }
  }

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

function asArrayEnvelopeItem(item: unknown): SoftProArrayEnvelopeItem {
  if (item === null || typeof item !== 'object') {
    return { Message: 'SoftPro array-envelope response item was not an object' };
  }

  const record = item as Record<string, unknown>;
  return {
    Status: typeof record.Status === 'number' ? record.Status : undefined,
    Message: typeof record.Message === 'string' ? record.Message : undefined,
    FileUploadedStatus: typeof record.FileUploadedStatus === 'boolean' ? record.FileUploadedStatus : undefined,
    OrderNumber: typeof record.OrderNumber === 'string' ? record.OrderNumber : undefined,
    Id: typeof record.Id === 'string' ? record.Id : undefined,
  };
}

function evaluateArrayEnvelope(raw: unknown, httpStatus: number): SoftProArrayEnvelopeEvaluation {
  if (!Array.isArray(raw)) {
    const category = categorizeSoftProResponse({
      httpStatus,
      message: 'SoftPro array-envelope response was not an array',
    });
    return {
      success: false,
      category,
      retryable: isRetryableSoftProError(category),
      message: 'SoftPro array-envelope response was not an array',
      itemCount: 0,
      failedCount: 0,
      items: [],
      failedItems: [],
    };
  }

  const items = raw.map(asArrayEnvelopeItem);
  const failedItems = items
    .map((item, index) => ({ ...item, index }))
    .filter((item) => (
      item.Status !== 200
      || item.FileUploadedStatus === false
    ));

  if (items.length === 0) {
    const category = categorizeSoftProResponse({
      httpStatus,
      message: 'SoftPro array-envelope response was empty',
    });
    return {
      success: false,
      category,
      retryable: isRetryableSoftProError(category),
      message: 'SoftPro array-envelope response was empty',
      itemCount: 0,
      failedCount: 0,
      items,
      failedItems,
    };
  }

  if (failedItems.length === 0 && httpStatus < 400) {
    return {
      success: true,
      category: 'ok',
      retryable: false,
      message: 'Success',
      itemCount: items.length,
      failedCount: 0,
      items,
      failedItems,
    };
  }

  const firstFailure = failedItems[0];
  const category = firstFailure
    ? categorizeSoftProResponse({
      bodyStatus: firstFailure.Status,
      httpStatus,
      message: firstFailure.Message,
    })
    : categorizeSoftProResponse({ httpStatus, message: 'SoftPro array-envelope response failed' });
  const retryable = isRetryableSoftProError(category);
  const details = failedItems
    .map((item) => `item ${item.index}: Status=${item.Status ?? 'missing'}, FileUploadedStatus=${String(item.FileUploadedStatus)}, Message=${item.Message ?? 'none'}`)
    .join('; ');

  return {
    success: false,
    category,
    retryable,
    message: details || 'SoftPro array-envelope response failed',
    itemCount: items.length,
    failedCount: failedItems.length,
    items,
    failedItems,
  };
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
    bodyShape?: 'object' | 'array';
    responseShape?: 'envelope' | 'array';
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
    const shouldAddUserId = isWrite && options?.bodyShape !== 'array';
    const body = shouldAddUserId && options?.body
      ? addSoftProUserIdToWritePayload(options.body, options.userContext)
      : options?.body;
    const loggedBody = body ? redactSoftProAuthFields(body) : undefined;

    const fetchOptions: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(options?.timeoutMs ?? 60_000),
    };

    if (method === 'POST' && body) {
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(url, fetchOptions);

    let parsed: unknown;
    let rawText: string | undefined;
    try {
      rawText = await response.text();
      parsed = JSON.parse(rawText) as unknown;
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
        requestMeta: { url, method, ...(loggedBody ? { payload: loggedBody } : { queryParams: options?.queryParams }) },
        responseMeta: { bodyStatus: null, rawSnippet: (rawText ?? '').slice(0, 500) },
      });
      return vendorError<T>(VENDOR, softProCategoryToErrorCode(category), `Non-JSON response (HTTP ${response.status}): ${(rawText ?? '').slice(0, 200)}`, {
        httpStatus: response.status, requestId, durationMs, retryable,
      });
    }

    const durationMs = Date.now() - startedAt.getTime();

    if (options?.responseShape === 'array') {
      const evaluated = evaluateArrayEnvelope(parsed, response.status);

      await logRequest({
        operation,
        orderId: options?.orderId,
        requestId,
        startedAt,
        success: evaluated.success,
        httpStatus: response.status,
        retryable: evaluated.success ? false : evaluated.retryable,
        errorCategory: evaluated.success ? undefined : evaluated.category,
        requestMeta: { url, method, ...(loggedBody ? { payload: loggedBody } : { queryParams: options?.queryParams }) },
        responseMeta: {
          responseShape: 'array',
          itemCount: evaluated.itemCount,
          failedCount: evaluated.failedCount,
          items: evaluated.items,
          failedItems: evaluated.failedItems,
        },
      });

      if (evaluated.success) {
        return vendorSuccess(parsed as T, { requestId, durationMs });
      }

      return vendorError<T>(
        VENDOR,
        softProCategoryToErrorCode(evaluated.category),
        evaluated.message,
        {
          httpStatus: response.status,
          requestId,
          durationMs,
          retryable: evaluated.retryable,
        },
      );
    }

    const raw = parsed as SoftProResponse<T>;
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
      requestMeta: { url, method, ...(loggedBody ? { payload: loggedBody } : { queryParams: options?.queryParams }) },
      responseMeta: success
        ? buildSuccessResponseMeta(operation, raw, options?.queryParams)
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
    const isConfigError = err instanceof SoftProConfigError;

    await logRequest({
      operation,
      orderId: options?.orderId,
      requestId,
      startedAt,
      success: false,
      retryable: !isConfigError,
      errorCategory: isConfigError ? 'auth' : 'unknown',
      requestMeta: {
        url,
        method,
        ...(options?.body ? { payload: redactSoftProAuthFields(options.body) } : {}),
      },
      responseMeta: { bodyStatus: null, error: message },
    });

    return vendorError<T>(VENDOR, isConfigError ? 'AUTH' : 'NETWORK_ERROR', message, {
      retryable: !isConfigError,
      requestId,
      durationMs,
    });
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Create-only. Observed create p50 21s / p95 39s / max 57s; 60s was clipping
 * the tail. Report the new tail after a week. Other SoftPro ops stay at 60s.
 */
export const CREATE_ORDER_TIMEOUT_MS = 120_000;

export async function createOrder(
  payload: Record<string, unknown>
): Promise<VendorResult<{ orderNumber: string }>> {
  const requestId = crypto.randomUUID();
  const startedAt = new Date();
  const url = getBaseUrl() + SOFTPRO_ENDPOINTS.createOrder;
  let loggedPayload: ReturnType<typeof redactSoftProAuthFields> | undefined;

  try {
    const payloadWithUserId = addSoftProUserIdToRecord(payload);
    loggedPayload = redactSoftProAuthFields(payloadWithUserId);
    const hdrs: Record<string, string> = {
      'Content-Type': 'application/json',
      ...buildSoftProHeaders({ requireToken: true }),
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: hdrs,
      body: JSON.stringify(payloadWithUserId),
      signal: AbortSignal.timeout(CREATE_ORDER_TIMEOUT_MS),
    });

    const raw = (await response.json()) as SoftProResponse & { OrderNumber?: string };
    const durationMs = Date.now() - startedAt.getTime();

    await logRequest({
      operation: 'create_order', requestId, startedAt,
      success: raw.Status === 200,
      httpStatus: response.status,
      requestMeta: { url, method: 'POST', payload: loggedPayload },
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
    const isConfigError = err instanceof SoftProConfigError;
    const isTimeout = !isConfigError && (
      (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError'))
      || /aborted due to timeout/i.test(message)
    );
    const code = isConfigError ? 'AUTH' : isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR';

    await logRequest({
      operation: 'create_order', requestId, startedAt,
      success: false,
      retryable: !isConfigError,
      errorCategory: isConfigError ? 'auth' : isTimeout ? 'timeout' : 'NETWORK',
      requestMeta: { url, method: 'POST', ...(loggedPayload ? { payload: loggedPayload } : {}) },
      responseMeta: { error: message },
    });

    return vendorError<{ orderNumber: string }>(VENDOR, code, message, {
      retryable: !isConfigError, requestId, durationMs,
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
  const loggedPayload = redactSoftProAuthFields(payload);

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

export async function getAttachedDocumentsPrelim(
  orderNumber: string
): Promise<VendorResult<SoftProAttachedDocument[]>> {
  return makeRequest<SoftProAttachedDocument[]>('GET', SOFTPRO_ENDPOINTS.getAttachedDocumentsPrelim, {
    queryParams: { orderNumber },
    operation: 'get_attached_documents_prelim',
  });
}

export interface SoftProUploadFile {
  folderName: string;
  fileUrl: string;
}

export async function uploadDocument(params: {
  documentId: number;
  orderId?: number;
  orderNumber: string;
  documentName: string;
  folderName?: string;
  fileUrl?: string;
  /** Legacy batches LV + grant deed + tax into one FileList, one POST. */
  files?: SoftProUploadFile[];
}): Promise<VendorResult<Array<{ Status?: number; Message?: string; Id?: string; FileUploadedStatus?: boolean }>>> {
  const files: SoftProUploadFile[] = params.files
    ?? (params.folderName && params.fileUrl
      ? [{ folderName: params.folderName, fileUrl: params.fileUrl }]
      : []);
  if (files.length === 0) {
    return vendorError('softpro', 'VALIDATION', 'AddDocuments FileList is empty');
  }

  // Legacy payload shape: array with Id, OrderNumber, DocumentName, FileList
  const body = [{
    Id: String(params.documentId),
    OrderNumber: params.orderNumber,
    DocumentName: params.documentName,
    FileList: files.map((f) => ({ FolderName: f.folderName, FileURL: f.fileUrl })),
  }];

  return makeRequest('POST', SOFTPRO_ENDPOINTS.uploadDocument, {
    body,
    operation: 'upload_document',
    orderId: params.orderId,
    bodyShape: 'array',
    responseShape: 'array',
  });
}

export async function getLookupTable(userType: string): Promise<VendorResult<SoftProLookupItem[]>>;
export async function getLookupTable(params: SoftProLookupTableRequest): Promise<VendorResult<SoftProLookupTablePage>>;
export async function getLookupTable(
  input: string | SoftProLookupTableRequest,
): Promise<VendorResult<SoftProLookupItem[] | SoftProLookupTablePage>> {
  if (typeof input === 'string') {
    return makeRequest<SoftProLookupItem[]>('GET', SOFTPRO_ENDPOINTS.getLookupTable, {
      queryParams: { userType: input },
      operation: 'get_lookup_table',
    });
  }

  const page = input.Page ?? 1;
  const pageSize = input.pageSize ?? 1000;
  const queryParams: Record<string, string> = {
    userType: input.userType,
    Page: String(page),
    pageSize: String(pageSize),
  };
  if (input.modifiedSince) {
    queryParams.modifiedSince = input.modifiedSince;
  }

  const requestId = crypto.randomUUID();
  const startedAt = new Date();
  const url = getBaseUrl() + SOFTPRO_ENDPOINTS.getLookupTable + '?' + new URLSearchParams(queryParams).toString();

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...buildSoftProHeaders({ requireToken: false }),
      },
      signal: AbortSignal.timeout(60_000),
    });

    let parsed: unknown;
    let rawText: string | undefined;
    try {
      rawText = await response.text();
      parsed = JSON.parse(rawText) as unknown;
    } catch {
      const durationMs = Date.now() - startedAt.getTime();
      const category = categorizeSoftProResponse({
        httpStatus: response.status,
        message: rawText,
      });
      const retryable = isRetryableSoftProError(category);
      await logRequest({
        operation: 'get_lookup_table',
        requestId,
        startedAt,
        success: false,
        httpStatus: response.status,
        retryable,
        errorCategory: category,
        requestMeta: { url, method: 'GET', queryParams },
        responseMeta: { bodyStatus: null, rawSnippet: (rawText ?? '').slice(0, 500) },
      });
      return vendorError<SoftProLookupTablePage>(
        VENDOR,
        softProCategoryToErrorCode(category),
        `Non-JSON response (HTTP ${response.status}): ${(rawText ?? '').slice(0, 200)}`,
        { httpStatus: response.status, requestId, durationMs, retryable },
      );
    }

    const raw = parsed as SoftProResponse<SoftProLookupItem[]> & {
      HasMore?: boolean;
      hasMore?: boolean;
      Page?: number;
      pageSize?: number;
    };
    const success = raw.Status === 200 && response.status < 400 && Array.isArray(raw.data);
    const category = categorizeSoftProResponse({
      bodyStatus: raw.Status,
      httpStatus: response.status,
      message: raw.Message,
    });
    const retryable = isRetryableSoftProError(category);
    const durationMs = Date.now() - startedAt.getTime();
    const pageData: SoftProLookupTablePage = {
      items: Array.isArray(raw.data) ? raw.data : [],
      hasMore: raw.HasMore === true || raw.hasMore === true,
      page: typeof raw.Page === 'number' ? raw.Page : page,
      pageSize: typeof raw.pageSize === 'number' ? raw.pageSize : pageSize,
      modifiedSince: input.modifiedSince ?? null,
    };

    await logRequest({
      operation: 'get_lookup_table',
      requestId,
      startedAt,
      success,
      httpStatus: response.status,
      retryable: success ? false : retryable,
      errorCategory: success ? undefined : category,
      requestMeta: { url, method: 'GET', queryParams },
      responseMeta: success
        ? {
          status: raw.Status,
          bodyStatus: raw.Status,
          message: raw.Message,
          resultCount: pageData.items.length,
          hasMore: pageData.hasMore,
          page: pageData.page,
          pageSize: pageData.pageSize,
          modifiedSince: pageData.modifiedSince,
        }
        : { status: raw.Status, bodyStatus: raw.Status, message: raw.Message, rawBody: raw },
    });

    if (success) {
      return vendorSuccess(pageData, { requestId, durationMs });
    }

    return vendorError<SoftProLookupTablePage>(
      VENDOR,
      softProCategoryToErrorCode(category),
      raw.Message || 'SoftPro lookup table failed',
      { httpStatus: response.status, requestId, durationMs, retryable },
    );
  } catch (err) {
    const durationMs = Date.now() - startedAt.getTime();
    const message = err instanceof Error ? err.message : 'Unknown error';
    const isConfigError = err instanceof SoftProConfigError;

    await logRequest({
      operation: 'get_lookup_table',
      requestId,
      startedAt,
      success: false,
      retryable: !isConfigError,
      errorCategory: isConfigError ? 'auth' : 'unknown',
      requestMeta: { url, method: 'GET', queryParams },
      responseMeta: { bodyStatus: null, error: message },
    });

    return vendorError<SoftProLookupTablePage>(
      VENDOR,
      isConfigError ? 'AUTH' : 'NETWORK_ERROR',
      message,
      { retryable: !isConfigError, requestId, durationMs },
    );
  }
}

export interface SoftProAddNotesResponseItem {
  Status?: number;
  Message?: string;
  Id?: string;
  [key: string]: unknown;
}

export async function addNotes(
  orderNumber: string,
  text: string,
  noteId?: string,
): Promise<VendorResult<SoftProAddNotesResponseItem[]>> {
  const body = [{
    OrderNumber: orderNumber,
    Text: text,
    ...(noteId ? { Id: noteId } : {}),
  }];

  return makeRequest<SoftProAddNotesResponseItem[]>('POST', SOFTPRO_ENDPOINTS.addNote, {
    body,
    operation: 'add_notes',
    bodyShape: 'array',
    responseShape: 'array',
  });
}

// AddDocuments, AddNotes, and future AddTask use array bodies/responses.
// Do not inject per-item UserId: INV-UPLOAD-DIFF proved that broke uploads.
// Before adapter auth is enforced globally, the Director must confirm with the
// API team how array-body endpoints carry auth (header-only, wrapper, exempt,
// or another shape). AddTask should use this same array path when exported.

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
