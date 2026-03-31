import { parseStringPromise } from 'xml2js';
import { vendorSuccess, vendorError } from '@/lib/integrations/types';
import type { VendorResult } from '@/lib/integrations/types';
import type { TitlePointDocumentResponse, TitlePointImageResponse } from './types';
import { VENDOR, logRequest } from './logging';
import { sendTitlePointPost } from './http';
import { buildLegacyGrantDeedParameters } from './params';
import { mockGetImage, mockRequestImage } from './mocks';
import { TP_ENDPOINTS, type TitlePointConfig, type TitlePointWireRequest } from './client';

function getConfig(): TitlePointConfig | null {
  const baseUrl = process.env.TP_BASE_URL;
  if (!baseUrl) return null;
  return {
    baseUrl: baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`,
    userID: process.env.TP_USERNAME ?? '',
    password: process.env.TP_PASSWORD ?? '',
  };
}

function buildSnippet(xml: string): string {
  return xml.slice(0, 6000);
}

function readPath(obj: unknown, ...keys: string[]): unknown {
  let current = obj;
  for (const key of keys) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

async function parseXml(xml: string): Promise<Record<string, unknown>> {
  return await parseStringPromise(xml, { explicitArray: false, ignoreAttrs: true }) as Record<string, unknown>;
}

export async function parseCreateRequest3LiveResponse(xml: string) {
  const parsed = await parseXml(xml);
  const root = (parsed.CreateAsynchServicesReturn ?? {}) as Record<string, unknown>;

  return {
    returnStatus: String(root.ReturnStatus ?? ''),
    requestId: String(root.RequestID ?? ''),
    orderId: String(root.OrderID ?? ''),
  };
}

export async function parseGetRequestStatusLiveResponse(xml: string) {
  const parsed = await parseXml(xml);
  const root = (parsed.GenerateImageRequestStatusReturn ?? {}) as Record<string, unknown>;

  return {
    returnStatus: String(root.ReturnStatus ?? ''),
    status: String(root.Status ?? '').toLowerCase(),
    message: String(root.Message ?? ''),
    requestId: String(root.RequestId ?? ''),
  };
}

export async function parseGetGeneratedImageLiveResponse(xml: string) {
  const parsed = await parseXml(xml);
  const root = (parsed.GenerateImageData ?? {}) as Record<string, unknown>;

  return {
    returnStatus: String(root.ReturnStatus ?? ''),
    status: String(root.Status ?? '').toLowerCase(),
    message: String(root.Message ?? ''),
    base64Data: String(root.Data ?? ''),
  };
}

export async function parseGrantDeedImageResponse(xml: string) {
  const parsed = await parseXml(xml);
  const root = (parsed.ImageResult ?? {}) as Record<string, unknown>;

  return {
    returnStatus: String(readPath(root, 'Status', 'Msg') ?? ''),
    docStatus: String(readPath(root, 'Documents', 'DocumentResponse', 'DocStatus', 'Msg') ?? ''),
    base64Data: String(readPath(root, 'Documents', 'DocumentResponse', 'Document', 'Body', 'Body') ?? ''),
  };
}

function buildResponseMeta(httpStatus: number, contentType: string | null, xml: string, extra?: Record<string, unknown>) {
  const rawSnippet = buildSnippet(xml);
  return {
    httpStatus,
    contentType,
    isHtml: /<html/i.test(rawSnippet),
    rawSnippet,
    ...extra,
  };
}

function getErrorDescription(root: Record<string, unknown>, fallback: string): string {
  return String(
    readPath(root, 'ReturnErrors', 'ReturnError', 'ErrorDescription')
    ?? readPath(root, 'Message')
    ?? fallback,
  );
}

async function logUnhandledError(params: {
  operation: string;
  orderId?: number;
  requestId: string;
  startedAt: Date;
  wire: TitlePointWireRequest;
  extra?: Record<string, unknown>;
  err: unknown;
}) {
  const message = params.err instanceof Error ? params.err.message : 'Unknown error';
  await logRequest({
    operation: params.operation,
    orderId: params.orderId,
    requestId: params.requestId,
    startedAt: params.startedAt,
    success: false,
    errorCategory: 'TP_TRANSPORT_ERROR',
    requestMeta: {
      ...params.extra,
      method: params.wire.method,
      url: params.wire.url,
      rawBody: params.wire.rawBody ?? null,
      contentType: params.wire.contentType ?? null,
    },
    responseMeta: { error: message },
  });
}

export function buildCreateRequest3Request(
  cfg: TitlePointConfig,
  serviceId: string,
): TitlePointWireRequest {
  const url = `${cfg.baseUrl}${TP_ENDPOINTS.createRequest3}`;
  const rawBody =
    `username=${cfg.userID}&` +
    `password=${cfg.password}&` +
    `serviceId1=${serviceId}&` +
    'serviceId2=&' +
    'source=&' +
    'clientKey1=&' +
    'clientKey2=&' +
    'sortOrder=&' +
    'fileType=pdf&';

  return { method: 'POST', url, rawBody, contentType: 'application/x-www-form-urlencoded' };
}

export function buildGetRequestStatusRequest(
  cfg: TitlePointConfig,
  imgRequestId: string,
): TitlePointWireRequest {
  const url = `${cfg.baseUrl}${TP_ENDPOINTS.getRequestStatus}`;
  const rawBody =
    `username=${cfg.userID}&` +
    `password=${cfg.password}&` +
    `requestId=${imgRequestId}&`;

  return { method: 'POST', url, rawBody, contentType: 'application/x-www-form-urlencoded' };
}

export function buildGetGeneratedImageRequest(
  cfg: TitlePointConfig,
  imgRequestId: string,
): TitlePointWireRequest {
  const url = `${cfg.baseUrl}${TP_ENDPOINTS.getGeneratedImage}`;
  const rawBody =
    `username=${cfg.userID}&` +
    `password=${cfg.password}&` +
    `requestId=${imgRequestId}&`;

  return { method: 'POST', url, rawBody, contentType: 'application/x-www-form-urlencoded' };
}

export function buildGetDocumentsByParameters3Request(
  cfg: TitlePointConfig,
  params: { fips: string; year: string; instrumentDocId: string },
): TitlePointWireRequest {
  const url = `${cfg.baseUrl}${TP_ENDPOINTS.getDocumentsByParameters3}`;
  const rawBody =
    `parameters=${buildLegacyGrantDeedParameters(params.fips, params.year, params.instrumentDocId)}&` +
    `username=${cfg.userID}&` +
    `password=${cfg.password}&` +
    'company=&' +
    'department=&' +
    'titleOfficer=&' +
    'pages=&' +
    'propertyOnly=FALSE&' +
    'maxPageCount=0&' +
    'maxSizeInKB=0&' +
    'additionalInfo=&' +
    'customerRef=&' +
    'fileType=PDF&';

  return { method: 'POST', url, rawBody, contentType: 'application/x-www-form-urlencoded' };
}

export async function requestImage(
  serviceId: string,
  orderId?: number,
): Promise<VendorResult<{ requestId: string; orderId: string }>> {
  const cfg = getConfig();
  const requestId = `tp-${crypto.randomUUID()}`;
  const startedAt = new Date();

  if (!cfg) return mockRequestImage(serviceId, orderId, requestId, startedAt);

  const wire = buildCreateRequest3Request(cfg, serviceId);

  try {
    const http = await sendTitlePointPost(wire.url, wire.rawBody ?? '');

    let createResult: Awaited<ReturnType<typeof parseCreateRequest3LiveResponse>>;
    try {
      createResult = await parseCreateRequest3LiveResponse(http.body);
    } catch (parseErr) {
      await logRequest({
        operation: 'request_image',
        orderId,
        requestId,
        startedAt,
        success: false,
        httpStatus: http.status,
        errorCategory: 'XML_PARSE_ERROR',
        requestMeta: { method: wire.method, url: wire.url, rawBody: wire.rawBody ?? null, contentType: wire.contentType ?? null, serviceId },
        responseMeta: {
          ...buildResponseMeta(http.status, http.response.contentType, http.body),
          parseError: parseErr instanceof Error ? parseErr.message : 'parse failed',
        },
      });
      return vendorError(VENDOR, 'IMAGE_REQUEST_FAILED', 'XML parse error — see vendor_api_logs for raw response', {
        requestId,
        durationMs: Date.now() - startedAt.getTime(),
      });
    }

    const returnStatus = createResult.returnStatus;
    const imgRequestId = createResult.requestId;
    const imgOrderId = createResult.orderId;

    if (returnStatus !== 'Success' || !imgRequestId) {
      const message = 'Image request failed';
      await logRequest({
        operation: 'request_image',
        orderId,
        requestId,
        startedAt,
        success: false,
        httpStatus: http.status,
        errorCategory: 'TP_IMAGE_ERROR',
        requestMeta: { method: wire.method, url: wire.url, rawBody: wire.rawBody ?? null, contentType: wire.contentType ?? null, serviceId },
        responseMeta: buildResponseMeta(http.status, http.response.contentType, http.body, {
          parsedRoot: 'CreateAsynchServicesReturn',
          returnStatus,
        }),
      });
      return vendorError(VENDOR, 'IMAGE_REQUEST_FAILED', message, {
        requestId,
        durationMs: Date.now() - startedAt.getTime(),
      });
    }

    await logRequest({
      operation: 'request_image',
      orderId,
      requestId,
      startedAt,
      success: true,
      httpStatus: http.status,
      requestMeta: { method: wire.method, url: wire.url, rawBody: wire.rawBody ?? null, contentType: wire.contentType ?? null, serviceId },
      responseMeta: buildResponseMeta(http.status, http.response.contentType, http.body, {
        parsedRoot: 'CreateAsynchServicesReturn',
        returnStatus,
        imgRequestId,
      }),
    });

    return vendorSuccess({ requestId: imgRequestId, orderId: imgOrderId }, {
      requestId,
      durationMs: Date.now() - startedAt.getTime(),
    });
  } catch (err) {
    await logUnhandledError({ operation: 'request_image', orderId, requestId, startedAt, wire, extra: { serviceId }, err });
    const message = err instanceof Error ? err.message : 'Unknown error';
    return vendorError(VENDOR, 'IMAGE_REQUEST_FAILED', message, {
      requestId,
      durationMs: Date.now() - startedAt.getTime(),
    });
  }
}

export async function getRequestStatus(
  imgRequestId: string,
  orderId?: number,
): Promise<VendorResult<{ status: string; returnStatus: string; message?: string; requestId?: string }>> {
  const cfg = getConfig();
  const requestId = `tp-${crypto.randomUUID()}`;
  const startedAt = new Date();

  if (!cfg) {
    return vendorSuccess({ status: 'success', returnStatus: 'Success' }, { requestId, durationMs: 0 });
  }

  const wire = buildGetRequestStatusRequest(cfg, imgRequestId);
  const MAX_POLLS = 4;

  try {
    for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
      const http = await sendTitlePointPost(wire.url, wire.rawBody ?? '');

      let statusResult: Awaited<ReturnType<typeof parseGetRequestStatusLiveResponse>>;
      try {
        statusResult = await parseGetRequestStatusLiveResponse(http.body);
      } catch (parseErr) {
        await logRequest({
          operation: 'get_request_status',
          orderId,
          requestId,
          startedAt,
          success: false,
          httpStatus: http.status,
          errorCategory: 'XML_PARSE_ERROR',
          requestMeta: { method: wire.method, url: wire.url, rawBody: wire.rawBody ?? null, contentType: wire.contentType ?? null, imgRequestId, attempt },
          responseMeta: {
            ...buildResponseMeta(http.status, http.response.contentType, http.body),
            parseError: parseErr instanceof Error ? parseErr.message : 'parse failed',
          },
        });
        return vendorError(VENDOR, 'IMAGE_STATUS_FAILED', 'XML parse error — see vendor_api_logs', {
          requestId,
          durationMs: Date.now() - startedAt.getTime(),
        });
      }

      const returnStatus = statusResult.returnStatus;
      const status = statusResult.status;
      const message = statusResult.message;

      if (returnStatus === 'Success' && (status === 'success' || status === 'ready' || status === 'complete' || status === 'completed')) {
        await logRequest({
          operation: 'get_request_status',
          orderId,
          requestId,
          startedAt,
          success: true,
          httpStatus: http.status,
          requestMeta: { method: wire.method, url: wire.url, rawBody: wire.rawBody ?? null, contentType: wire.contentType ?? null, imgRequestId },
          responseMeta: buildResponseMeta(http.status, http.response.contentType, http.body, {
            parsedRoot: 'GenerateImageRequestStatusReturn',
            returnStatus,
            status,
            message,
          }),
        });
        return vendorSuccess({ status, returnStatus, message, requestId: statusResult.requestId }, {
          requestId,
          durationMs: Date.now() - startedAt.getTime(),
        });
      }

      if (returnStatus === 'Success' && status === 'processing') {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }

      await logRequest({
        operation: 'get_request_status',
        orderId,
        requestId,
        startedAt,
        success: false,
        httpStatus: http.status,
        errorCategory: 'TP_IMAGE_STATUS',
        requestMeta: { method: wire.method, url: wire.url, rawBody: wire.rawBody ?? null, contentType: wire.contentType ?? null, imgRequestId },
        responseMeta: buildResponseMeta(http.status, http.response.contentType, http.body, {
          parsedRoot: 'GenerateImageRequestStatusReturn',
          returnStatus,
          status,
          message,
        }),
      });
      return vendorSuccess({ status: status || returnStatus.toLowerCase(), returnStatus, message, requestId: statusResult.requestId }, {
        requestId,
        durationMs: Date.now() - startedAt.getTime(),
      });
    }

    return vendorSuccess({ status: 'processing', returnStatus: 'Success' }, {
      requestId,
      durationMs: Date.now() - startedAt.getTime(),
    });
  } catch (err) {
    await logUnhandledError({ operation: 'get_request_status', orderId, requestId, startedAt, wire, extra: { imgRequestId }, err });
    const message = err instanceof Error ? err.message : 'Unknown error';
    return vendorError(VENDOR, 'IMAGE_STATUS_FAILED', message, {
      requestId,
      durationMs: Date.now() - startedAt.getTime(),
    });
  }
}

export async function getImage(
  imgRequestId: string,
  orderId?: number,
): Promise<VendorResult<TitlePointImageResponse>> {
  const cfg = getConfig();
  const requestId = `tp-${crypto.randomUUID()}`;
  const startedAt = new Date();

  if (!cfg) return mockGetImage(imgRequestId, orderId, requestId, startedAt);

  const wire = buildGetGeneratedImageRequest(cfg, imgRequestId);

  try {
    const http = await sendTitlePointPost(wire.url, wire.rawBody ?? '');

    let imageResult: Awaited<ReturnType<typeof parseGetGeneratedImageLiveResponse>>;
    try {
      imageResult = await parseGetGeneratedImageLiveResponse(http.body);
    } catch (parseErr) {
      await logRequest({
        operation: 'get_image',
        orderId,
        requestId,
        startedAt,
        success: false,
        httpStatus: http.status,
        errorCategory: 'XML_PARSE_ERROR',
        requestMeta: { method: wire.method, url: wire.url, rawBody: wire.rawBody ?? null, contentType: wire.contentType ?? null, imgRequestId },
        responseMeta: {
          ...buildResponseMeta(http.status, http.response.contentType, http.body),
          parseError: parseErr instanceof Error ? parseErr.message : 'parse failed',
        },
      });
      return vendorError(VENDOR, 'IMAGE_FETCH_FAILED', 'XML parse error — see vendor_api_logs for raw response', {
        requestId,
        durationMs: Date.now() - startedAt.getTime(),
      });
    }

    const returnStatus = imageResult.returnStatus;
    const status = imageResult.status;
    if (returnStatus !== 'Success') {
      const message = imageResult.message || `Image generation returned ${returnStatus}`;
      await logRequest({
        operation: 'get_image',
        orderId,
        requestId,
        startedAt,
        success: false,
        httpStatus: http.status,
        errorCategory: 'TP_IMAGE_ERROR',
        requestMeta: { method: wire.method, url: wire.url, rawBody: wire.rawBody ?? null, contentType: wire.contentType ?? null, imgRequestId },
        responseMeta: buildResponseMeta(http.status, http.response.contentType, http.body, {
          parsedRoot: 'GenerateImageData',
          returnStatus,
          status,
        }),
      });
      return vendorError(VENDOR, 'IMAGE_FETCH_FAILED', message, {
        requestId,
        durationMs: Date.now() - startedAt.getTime(),
      });
    }

    const base64Data = imageResult.base64Data;
    if (status === 'processing' || !base64Data) {
      await logRequest({
        operation: 'get_image',
        orderId,
        requestId,
        startedAt,
        success: false,
        httpStatus: http.status,
        errorCategory: 'TP_NO_IMAGE',
        requestMeta: { method: wire.method, url: wire.url, rawBody: wire.rawBody ?? null, contentType: wire.contentType ?? null, imgRequestId },
        responseMeta: buildResponseMeta(http.status, http.response.contentType, http.body, {
          parsedRoot: 'GenerateImageData',
          returnStatus,
          status,
        }),
      });
      return vendorSuccess({
        base64Data: '',
        status: status || 'processing',
        returnStatus,
      }, {
        requestId,
        durationMs: Date.now() - startedAt.getTime(),
      });
    }

    const response: TitlePointImageResponse = {
      base64Data,
      status: status || 'success',
      returnStatus,
    };
    await logRequest({
      operation: 'get_image',
      orderId,
      requestId,
      startedAt,
      success: true,
      httpStatus: http.status,
      requestMeta: { method: wire.method, url: wire.url, rawBody: wire.rawBody ?? null, contentType: wire.contentType ?? null, imgRequestId },
      responseMeta: buildResponseMeta(http.status, http.response.contentType, http.body, {
        parsedRoot: 'GenerateImageData',
        returnStatus,
        status,
        size: base64Data.length,
      }),
    });

    return vendorSuccess(response, { requestId, durationMs: Date.now() - startedAt.getTime() });
  } catch (err) {
    await logUnhandledError({ operation: 'get_image', orderId, requestId, startedAt, wire, extra: { imgRequestId }, err });
    const message = err instanceof Error ? err.message : 'Unknown error';
    return vendorError(VENDOR, 'IMAGE_FETCH_FAILED', message, {
      requestId,
      durationMs: Date.now() - startedAt.getTime(),
    });
  }
}

export async function getDocumentsByParameters3(
  params: { fips: string; year: string; instrumentDocId: string },
  orderId?: number,
): Promise<VendorResult<TitlePointDocumentResponse>> {
  const cfg = getConfig();
  const requestId = `tp-${crypto.randomUUID()}`;
  const startedAt = new Date();

  if (!cfg) {
    const { MOCK_PDF_BASE64 } = await import('./logging');
    await logRequest({
      operation: 'get_documents_by_parameters3',
      orderId,
      requestId,
      startedAt,
      success: true,
      requestMeta: params,
    });
    return vendorSuccess({ base64Data: MOCK_PDF_BASE64, returnStatus: 'OK' }, {
      requestId,
      durationMs: Date.now() - startedAt.getTime(),
    });
  }

  const wire = buildGetDocumentsByParameters3Request(cfg, params);

  try {
    const http = await sendTitlePointPost(wire.url, wire.rawBody ?? '', 60_000);

    let parsedGrantDeed: Awaited<ReturnType<typeof parseGrantDeedImageResponse>>;
    try {
      parsedGrantDeed = await parseGrantDeedImageResponse(http.body);
    } catch (parseErr) {
      await logRequest({
        operation: 'get_documents_by_parameters3',
        orderId,
        requestId,
        startedAt,
        success: false,
        httpStatus: http.status,
        errorCategory: 'XML_PARSE_ERROR',
        requestMeta: { method: wire.method, url: wire.url, rawBody: wire.rawBody ?? null, contentType: wire.contentType ?? null, ...params },
        responseMeta: {
          ...buildResponseMeta(http.status, http.response.contentType, http.body),
          parseError: parseErr instanceof Error ? parseErr.message : 'parse failed',
        },
      });
      return vendorError(VENDOR, 'DOCUMENT_FETCH_FAILED', 'XML parse error — see vendor_api_logs for raw response', {
        requestId,
        durationMs: Date.now() - startedAt.getTime(),
      });
    }

    const returnStatus = parsedGrantDeed.returnStatus;
    const docStatus = parsedGrantDeed.docStatus.toLowerCase();

    if (docStatus !== 'ok' || returnStatus.toLowerCase() !== 'ok') {
      const message = String(
        parsedGrantDeed.docStatus
        ?? returnStatus
        ?? 'Grant deed request failed',
      );
      await logRequest({
        operation: 'get_documents_by_parameters3',
        orderId,
        requestId,
        startedAt,
        success: false,
        httpStatus: http.status,
        errorCategory: 'TP_DOC_ERROR',
        requestMeta: { method: wire.method, url: wire.url, rawBody: wire.rawBody ?? null, contentType: wire.contentType ?? null, ...params },
        responseMeta: buildResponseMeta(http.status, http.response.contentType, http.body, {
          parsedRoot: 'ImageResult',
          returnStatus,
          docStatus,
        }),
      });
      return vendorError(VENDOR, 'DOCUMENT_FETCH_FAILED', message, {
        requestId,
        durationMs: Date.now() - startedAt.getTime(),
      });
    }

    const base64Data = parsedGrantDeed.base64Data;
    if (!base64Data) {
      await logRequest({
        operation: 'get_documents_by_parameters3',
        orderId,
        requestId,
        startedAt,
        success: false,
        httpStatus: http.status,
        errorCategory: 'TP_NO_DOCUMENT',
        requestMeta: { method: wire.method, url: wire.url, rawBody: wire.rawBody ?? null, contentType: wire.contentType ?? null, ...params },
        responseMeta: buildResponseMeta(http.status, http.response.contentType, http.body, {
          parsedRoot: 'ImageResult',
          returnStatus,
          docStatus,
        }),
      });
      return vendorError(VENDOR, 'DOCUMENT_FETCH_FAILED', 'No document data in response', {
        requestId,
        durationMs: Date.now() - startedAt.getTime(),
      });
    }

    await logRequest({
      operation: 'get_documents_by_parameters3',
      orderId,
      requestId,
      startedAt,
      success: true,
      httpStatus: http.status,
      requestMeta: { method: wire.method, url: wire.url, rawBody: wire.rawBody ?? null, contentType: wire.contentType ?? null, ...params },
      responseMeta: buildResponseMeta(http.status, http.response.contentType, http.body, {
        parsedRoot: 'ImageResult',
        returnStatus,
        docStatus,
        size: base64Data.length,
      }),
    });

    return vendorSuccess({ base64Data, returnStatus }, {
      requestId,
      durationMs: Date.now() - startedAt.getTime(),
    });
  } catch (err) {
    await logUnhandledError({ operation: 'get_documents_by_parameters3', orderId, requestId, startedAt, wire, extra: params, err });
    const message = err instanceof Error ? err.message : 'Unknown error';
    return vendorError(VENDOR, 'DOCUMENT_FETCH_FAILED', message, {
      requestId,
      durationMs: Date.now() - startedAt.getTime(),
    });
  }
}
