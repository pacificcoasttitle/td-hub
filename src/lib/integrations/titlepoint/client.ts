import { vendorSuccess, vendorError } from '@/lib/integrations/types';
import type { VendorResult } from '@/lib/integrations/types';
import { db } from '@/lib/db/client';
import { vendorApiLogs } from '@/lib/db/schema';
import type {
  TitlePointCreateInput,
  TitlePointCreateResponse,
  TitlePointSummaryResponse,
  TitlePointResultResponse,
  TitlePointImageResponse,
} from './types';

const VENDOR = 'titlepoint';

// ─── Endpoint Paths ──────────────────────────────────────────────────────────

export const TP_ENDPOINTS = {
  createService3: 'TpsService.asmx/CreateService3',
  createService4: 'TpsService.asmx/CreateService4',
  getRequestSummaries: 'TpsService.asmx/GetRequestSummaries',
  getResultById: 'TpsService.asmx/GetResultByID',
  getResultById3: 'TpsService.asmx/GetResultByID3',
  createRequest3: 'TpsGenerateImage.asmx/CreateRequest3',
  getRequestStatus: 'TpsGenerateImage.asmx/GetRequestStatus',
  getGeneratedImage: 'TpsGenerateImage.asmx/GetGeneratedImage',
  getDocumentsByParameters3: 'TpsImage.asmx/GetDocumentsByParameters3',
} as const;

// ─── Config ──────────────────────────────────────────────────────────────────

function getConfig() {
  const baseUrl = process.env.TP_BASE_URL;
  if (!baseUrl) return null;
  return {
    baseUrl: baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl,
    userID: process.env.TP_USERNAME ?? '',
    password: process.env.TP_PASSWORD ?? '',
  };
}

function authParams(config: { userID: string; password: string }): Record<string, string> {
  return { userID: config.userID, password: config.password };
}

// ─── Vendor Logging ─────────────────────────────────────────────────────────

async function logRequest(params: {
  operation: string;
  orderId?: number;
  requestId: string;
  startedAt: Date;
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
      endedAt: new Date(),
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

// ─── Mock Poll State ────────────────────────────────────────────────────────
// Simulates: first poll returns 'pending', second returns 'success'

const pollCounts = new Map<string, number>();

// ─── Mock Helpers ───────────────────────────────────────────────────────────

const MOCK_PDF_BASE64 =
  'JVBERi0xLjAKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2Jq' +
  'CjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2Jq' +
  'CjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiA+PgplbmRvYmoKeHJlZgowIDQK' +
  'dHJhaWxlcgo8PCAvUm9vdCAxIDAgUiAvU2l6ZSA0ID4+CnN0YXJ0eHJlZgoxNDAKJSVFT0YK';

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── CreateService3 ─────────────────────────────────────────────────────────

export async function createService(
  input: TitlePointCreateInput,
  orderId?: number
): Promise<VendorResult<TitlePointCreateResponse>> {
  const requestId = `tp-${crypto.randomUUID()}`;
  const startedAt = new Date();

  try {
    await delay(40);

    const tpRequestId = `REQ-${Date.now()}`;
    const tpOrderId = `ORD-${Date.now()}`;

    await logRequest({
      operation: 'create_service',
      orderId,
      requestId,
      startedAt,
      success: true,
      httpStatus: 200,
      requestMeta: { searchType: input.searchType, address: input.address },
      responseMeta: { tpRequestId, tpOrderId },
    });

    return vendorSuccess<TitlePointCreateResponse>(
      { requestId: tpRequestId, orderId: tpOrderId, returnStatus: 'OK' },
      { requestId, durationMs: Date.now() - startedAt.getTime() }
    );
  } catch (err) {
    await logRequest({
      operation: 'create_service',
      orderId,
      requestId,
      startedAt,
      success: false,
      errorCategory: 'create_failed',
    });

    return vendorError<TitlePointCreateResponse>(
      VENDOR,
      'CREATE_SERVICE_FAILED',
      err instanceof Error ? err.message : 'Unknown error',
      { requestId, durationMs: Date.now() - startedAt.getTime() }
    );
  }
}

// ─── GetRequestSummaries ────────────────────────────────────────────────────

export async function getRequestSummaries(
  tpRequestId: string,
  orderId?: number
): Promise<VendorResult<TitlePointSummaryResponse>> {
  const requestId = `tp-${crypto.randomUUID()}`;
  const startedAt = new Date();

  try {
    await delay(30);

    const count = (pollCounts.get(tpRequestId) ?? 0) + 1;
    pollCounts.set(tpRequestId, count);

    const isPending = count === 1;
    const response: TitlePointSummaryResponse = isPending
      ? { status: 'pending', serviceIds: [], message: 'Processing...' }
      : { status: 'success', serviceIds: [`SVC-${tpRequestId}-001`] };

    if (!isPending) {
      pollCounts.delete(tpRequestId);
    }

    await logRequest({
      operation: 'get_request_summaries',
      orderId,
      requestId,
      startedAt,
      success: true,
      httpStatus: 200,
      requestMeta: { tpRequestId, pollCount: count },
      responseMeta: { status: response.status, serviceCount: response.serviceIds.length },
    });

    return vendorSuccess(response, {
      requestId,
      durationMs: Date.now() - startedAt.getTime(),
    });
  } catch (err) {
    await logRequest({
      operation: 'get_request_summaries',
      orderId,
      requestId,
      startedAt,
      success: false,
      errorCategory: 'poll_failed',
    });

    return vendorError<TitlePointSummaryResponse>(
      VENDOR,
      'POLL_FAILED',
      err instanceof Error ? err.message : 'Unknown error',
      { requestId, durationMs: Date.now() - startedAt.getTime() }
    );
  }
}

// ─── GetResultByID3 ─────────────────────────────────────────────────────────

export async function getResult(
  serviceId: string,
  orderId?: number
): Promise<VendorResult<TitlePointResultResponse>> {
  const requestId = `tp-${crypto.randomUUID()}`;
  const startedAt = new Date();

  try {
    await delay(30);

    const response: TitlePointResultResponse = {
      serviceId,
      data: {
        propertyAddress: '123 Main St',
        city: 'Glendale',
        state: 'CA',
        zip: '91203',
        owner: 'John Doe & Jane Doe',
        legalDescription: 'Lot 1, Block A, Tract 12345',
        apn: '5678-001-001',
      },
      returnStatus: 'Success',
    };

    await logRequest({
      operation: 'get_result',
      orderId,
      requestId,
      startedAt,
      success: true,
      httpStatus: 200,
      requestMeta: { serviceId },
    });

    return vendorSuccess(response, {
      requestId,
      durationMs: Date.now() - startedAt.getTime(),
    });
  } catch (err) {
    await logRequest({
      operation: 'get_result',
      orderId,
      requestId,
      startedAt,
      success: false,
      errorCategory: 'result_fetch_failed',
    });

    return vendorError<TitlePointResultResponse>(
      VENDOR,
      'RESULT_FETCH_FAILED',
      err instanceof Error ? err.message : 'Unknown error',
      { requestId, durationMs: Date.now() - startedAt.getTime() }
    );
  }
}

// ─── Image Request ──────────────────────────────────────────────────────────

export async function requestImage(
  serviceId: string,
  orderId?: number
): Promise<VendorResult<{ requestId: string; orderId: string }>> {
  const requestId = `tp-${crypto.randomUUID()}`;
  const startedAt = new Date();

  try {
    await delay(20);

    const imgRequestId = `IMG-${Date.now()}`;
    const imgOrderId = `IORD-${Date.now()}`;

    await logRequest({
      operation: 'request_image',
      orderId,
      requestId,
      startedAt,
      success: true,
      httpStatus: 200,
      requestMeta: { serviceId },
      responseMeta: { imgRequestId },
    });

    return vendorSuccess(
      { requestId: imgRequestId, orderId: imgOrderId },
      { requestId, durationMs: Date.now() - startedAt.getTime() }
    );
  } catch (err) {
    await logRequest({
      operation: 'request_image',
      orderId,
      requestId,
      startedAt,
      success: false,
      errorCategory: 'image_request_failed',
    });

    return vendorError<{ requestId: string; orderId: string }>(
      VENDOR,
      'IMAGE_REQUEST_FAILED',
      err instanceof Error ? err.message : 'Unknown error',
      { requestId, durationMs: Date.now() - startedAt.getTime() }
    );
  }
}

// ─── Image Retrieval ────────────────────────────────────────────────────────

export async function getImage(
  imgRequestId: string,
  orderId?: number
): Promise<VendorResult<TitlePointImageResponse>> {
  const requestId = `tp-${crypto.randomUUID()}`;
  const startedAt = new Date();

  try {
    await delay(30);

    const response: TitlePointImageResponse = {
      base64Data: MOCK_PDF_BASE64,
      status: 'Success',
      returnStatus: 'OK',
    };

    await logRequest({
      operation: 'get_image',
      orderId,
      requestId,
      startedAt,
      success: true,
      httpStatus: 200,
      requestMeta: { imgRequestId },
    });

    return vendorSuccess(response, {
      requestId,
      durationMs: Date.now() - startedAt.getTime(),
    });
  } catch (err) {
    await logRequest({
      operation: 'get_image',
      orderId,
      requestId,
      startedAt,
      success: false,
      errorCategory: 'image_fetch_failed',
    });

    return vendorError<TitlePointImageResponse>(
      VENDOR,
      'IMAGE_FETCH_FAILED',
      err instanceof Error ? err.message : 'Unknown error',
      { requestId, durationMs: Date.now() - startedAt.getTime() }
    );
  }
}
