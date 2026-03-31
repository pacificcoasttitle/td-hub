import { parseStringPromise } from 'xml2js';
import { vendorSuccess, vendorError } from '@/lib/integrations/types';
import type { VendorResult } from '@/lib/integrations/types';
import { uploadFile } from '@/lib/integrations/s3/client';
import type {
  TitlePointCreateInput,
  TitlePointCreateResponse,
  TitlePointResultResponse,
  TitlePointSummaryResponse,
} from './types';
import { VENDOR, logRequest } from './logging';
import { sendTitlePointGet, sendTitlePointPost } from './http';
import {
  SERVICE_TYPE_MAP,
  buildLegacyGeoParameters,
  buildLegacyLvParameters,
  buildLegacyTaxParameters,
} from './params';
import { mockCreateService, mockGetRequestSummaries, mockGetResult } from './mocks';

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

export interface TitlePointConfig {
  baseUrl: string;
  userID: string;
  password: string;
}

export interface TitlePointWireRequest {
  method: 'GET' | 'POST';
  url: string;
  rawBody?: string;
  contentType?: 'application/x-www-form-urlencoded';
}

function getConfig(): TitlePointConfig | null {
  const baseUrl = process.env.TP_BASE_URL;
  if (!baseUrl) return null;
  return {
    baseUrl: baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`,
    userID: process.env.TP_USERNAME ?? '',
    password: process.env.TP_PASSWORD ?? '',
  };
}

function encodeValue(value: string): string {
  return encodeURIComponent(value).replace(/%20/g, '+');
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

function asList(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object');
  }
  if (value && typeof value === 'object') {
    return [value as Record<string, unknown>];
  }
  return [];
}

async function parseXml(xml: string): Promise<Record<string, unknown>> {
  return await parseStringPromise(xml, { explicitArray: false, ignoreAttrs: true }) as Record<string, unknown>;
}

// Live vendor responses for these paths do not root at ServiceResult.
// Verify against docs/titlepoint/TITLEPOINT_IMPLEMENTATION_SOURCE_OF_TRUTH.md before changing.
export async function parseCreateServiceLiveResponse(xml: string) {
  const parsed = await parseXml(xml);
  const root = (parsed.CreateAsynchServicesReturn ?? {}) as Record<string, unknown>;

  return {
    returnStatus: String(root.ReturnStatus ?? ''),
    requestId: String(root.RequestID ?? ''),
    orderId: String(root.OrderID ?? ''),
    errorDescription: getServiceErrorDescription(root, ''),
  };
}

export async function parseGetRequestSummariesLiveResponse(xml: string) {
  const parsed = await parseXml(xml);
  const root = (parsed.GetRequestSummariesReturn ?? {}) as Record<string, unknown>;
  const requestSummaries = readPath(root, 'RequestSummaries', 'RequestSummary');
  const summaryList = asList(requestSummaries);
  const serviceIds: string[] = [];
  const resultIds: string[] = [];
  const orderIds: string[] = [];
  let status: 'pending' | 'success' | 'failed' = 'pending';
  let message: string | undefined;

  for (const summary of summaryList) {
    const summaryStatus = String(summary.Status ?? '').toLowerCase();
    const orderId = String(readPath(summary, 'Order', 'ID') ?? '');
    if (orderId) orderIds.push(orderId);

    if (summaryStatus === 'failed' || summaryStatus === 'error') {
      status = 'failed';
      message = String(summary.Message ?? summary.ErrorDescription ?? 'Search failed');
      continue;
    }

    if (summaryStatus === 'complete' || summaryStatus === 'completed' || summaryStatus === 'success') {
      status = 'success';
    }

    const services = asList(readPath(summary, 'Order', 'Services', 'Service'));
    for (const service of services) {
      const serviceId = String(service.ID ?? service.ServiceID ?? '');
      if (serviceId) serviceIds.push(serviceId);

      const thumbs = asList(readPath(service, 'ThumbNails', 'ResultThumbNail'));
      for (const thumb of thumbs) {
        const resultId = String(thumb.ID ?? '');
        if (resultId && resultId !== '0') resultIds.push(resultId);
      }
    }
  }

  return {
    returnStatus: String(root.ReturnStatus ?? ''),
    status,
    serviceIds,
    resultIds,
    orderIds,
    message,
  };
}

export async function parseLvGetResultLiveResponse(xml: string) {
  const parsed = await parseXml(xml);
  const root = (parsed.GetResultReturn ?? {}) as Record<string, unknown>;
  const result = (root.Result ?? {}) as Record<string, unknown>;

  return {
    returnStatus: String(root.ReturnStatus ?? ''),
    data: {
      ID: result.ID ?? '',
      Status: result.Status ?? '',
      Fips: result.Fips ?? '',
      BriefLegal: result.BriefLegal ?? '',
      Vesting: result.Vesting ?? '',
      Apn: result.Apn ?? '',
      PropertyAddress: result.PropertyAddress ?? '',
      LvDeeds: result.LvDeeds ?? {},
    } as Record<string, unknown>,
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

function getServiceErrorDescription(root: Record<string, unknown>, fallback: string): string {
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

export function buildPostOrderGeoCreateServiceRequest(
  cfg: TitlePointConfig,
  input: TitlePointCreateInput,
): TitlePointWireRequest {
  const url = `${cfg.baseUrl}${TP_ENDPOINTS.createService3}`;
  const rawBody =
    `userID=${cfg.userID}&` +
    `password=${cfg.password}&` +
    `serviceType=${SERVICE_TYPE_MAP.geo_address}&` +
    `parameters=${buildLegacyGeoParameters(input.address)}&` +
    'department=&' +
    'orderNo=&' +
    'customerRef=&' +
    'company=&' +
    'titleOfficer=&' +
    'orderComment=&' +
    'starterRemarks=&' +
    `state=${input.state}&` +
    `county=${input.county ?? ''}&`;

  return { method: 'POST', url, rawBody, contentType: 'application/x-www-form-urlencoded' };
}

export function buildPostOrderTaxCreateServiceRequest(
  cfg: TitlePointConfig,
  input: TitlePointCreateInput,
): TitlePointWireRequest {
  const url = `${cfg.baseUrl}${TP_ENDPOINTS.createService3}`;
  const rawBody =
    `userID=${cfg.userID}&` +
    `password=${cfg.password}&` +
    `serviceType=${SERVICE_TYPE_MAP.tax}&` +
    `parameters=${buildLegacyTaxParameters(input.apn)}&` +
    'department=&' +
    'orderNo=&' +
    'customerRef=&' +
    'company=&' +
    'titleOfficer=&' +
    'orderComment=&' +
    'starterRemarks=&' +
    `state=${input.state}&` +
    `county=${input.county ?? ''}&`;

  return { method: 'POST', url, rawBody, contentType: 'application/x-www-form-urlencoded' };
}

export function buildPostOrderLvCreateServiceRequest(
  cfg: TitlePointConfig,
  input: TitlePointCreateInput,
): TitlePointWireRequest {
  const url = `${cfg.baseUrl}${TP_ENDPOINTS.createService4}`;
  const rawBody =
    `userID=${cfg.userID}&` +
    `password=${cfg.password}&` +
    `serviceType=${SERVICE_TYPE_MAP.legal_vesting}&` +
    `parameters=${buildLegacyLvParameters({
      address: input.address,
      city: input.city,
      apn: input.apn,
      includeAddressApn: true,
    })}&` +
    'department=&' +
    'orderNo=&' +
    'customerRef=&' +
    'company=&' +
    'titleOfficer=&' +
    'orderComment=&' +
    'starterRemarks=&' +
    `fipsCode=${input.fips ?? ''}&`;

  return { method: 'POST', url, rawBody, contentType: 'application/x-www-form-urlencoded' };
}

export function buildPreOrderTaxCreateServiceRequest(
  cfg: TitlePointConfig,
  input: TitlePointCreateInput,
  customerRef: string,
): TitlePointWireRequest {
  const url =
    `${cfg.baseUrl}${TP_ENDPOINTS.createService3}?` +
    `userID=${encodeValue(cfg.userID)}&` +
    `password=${encodeValue(cfg.password)}&` +
    'orderNo=&' +
    `customerRef=${encodeValue(customerRef)}&` +
    'company=&' +
    'department=&' +
    'titleOfficer=&' +
    'orderComment=&' +
    'starterRemarks=&' +
    `serviceType=${encodeValue(SERVICE_TYPE_MAP.tax)}&` +
    `parameters=${encodeValue(buildLegacyTaxParameters(input.apn))}&` +
    `state=${encodeValue(input.state)}&` +
    `county=${encodeValue(input.county ?? '')}`;

  return { method: 'GET', url };
}

export function buildPreOrderLvCreateServiceRequest(
  cfg: TitlePointConfig,
  input: TitlePointCreateInput,
  includeAddressApn: boolean,
  customerRef: string,
): TitlePointWireRequest {
  const url =
    `${cfg.baseUrl}${TP_ENDPOINTS.createService4}?` +
    `userID=${encodeValue(cfg.userID)}&` +
    `password=${encodeValue(cfg.password)}&` +
    'orderNo=&' +
    `customerRef=${encodeValue(customerRef)}&` +
    'company=&' +
    'department=&' +
    'titleOfficer=&' +
    'orderComment=&' +
    'starterRemarks=&' +
    `serviceType=${encodeValue(SERVICE_TYPE_MAP.legal_vesting)}&` +
    `parameters=${encodeValue(buildLegacyLvParameters({
      address: input.address,
      city: input.city,
      apn: input.apn,
      includeAddressApn,
    }))}&` +
    `fipsCode=${encodeValue(input.fips ?? '')}`;

  return { method: 'GET', url };
}

export function buildGetRequestSummariesRequest(
  cfg: TitlePointConfig,
  tpRequestId: string,
): TitlePointWireRequest {
  const url =
    `${cfg.baseUrl}${TP_ENDPOINTS.getRequestSummaries}?` +
    `userID=${encodeValue(cfg.userID)}&` +
    `password=${encodeValue(cfg.password)}&` +
    'company=&' +
    'department=&' +
    'titleOfficer=&' +
    `requestId=${encodeValue(tpRequestId)}&` +
    'maxWaitSeconds=20';

  return { method: 'GET', url };
}

export function buildGetResultByIdRequest(
  cfg: TitlePointConfig,
  resultId: string,
): TitlePointWireRequest {
  const url =
    `${cfg.baseUrl}${TP_ENDPOINTS.getResultById}?` +
    `userID=${encodeValue(cfg.userID)}&` +
    `password=${encodeValue(cfg.password)}&` +
    'company=&' +
    'department=&' +
    'titleOfficer=&' +
    `resultID=${encodeValue(resultId)}`;

  return { method: 'GET', url };
}

export function buildTaxGetResultById3Request(
  cfg: TitlePointConfig,
  resultId: string,
): TitlePointWireRequest {
  const url =
    `${cfg.baseUrl}${TP_ENDPOINTS.getResultById3}?` +
    `userID=${encodeValue(cfg.userID)}&` +
    `password=${encodeValue(cfg.password)}&` +
    'company=&' +
    'department=&' +
    'titleOfficer=&' +
    `resultID=${encodeValue(resultId)}&` +
    'requestingTPXML=true';

  return { method: 'GET', url };
}

export function buildGeoGetResultById3GetRequest(
  cfg: TitlePointConfig,
  resultId: string,
): TitlePointWireRequest {
  const url =
    `${cfg.baseUrl}${TP_ENDPOINTS.getResultById3}?` +
    `userID=${encodeValue(cfg.userID)}&` +
    `password=${encodeValue(cfg.password)}&` +
    'company=&' +
    'department=&' +
    'titleOfficer=&' +
    'requestingTPXML=true&' +
    `resultID=${encodeValue(resultId)}`;

  return { method: 'GET', url };
}

export function buildGeoGetResultById3PostRequest(
  cfg: TitlePointConfig,
  resultId: string,
): TitlePointWireRequest {
  const url = `${cfg.baseUrl}${TP_ENDPOINTS.getResultById3}`;
  const rawBody =
    `userID=${cfg.userID}&` +
    `password=${cfg.password}&` +
    'company=&' +
    'department=&' +
    'titleOfficer=&' +
    'requestingTPXML=true&' +
    `resultID=${resultId}&`;

  return { method: 'POST', url, rawBody, contentType: 'application/x-www-form-urlencoded' };
}

async function runCreateService(
  wire: TitlePointWireRequest,
  orderId: number | undefined,
  requestId: string,
  startedAt: Date,
  extra: Record<string, unknown>,
): Promise<VendorResult<TitlePointCreateResponse>> {
  try {
    const http = wire.method === 'GET'
      ? await sendTitlePointGet(wire.url)
      : await sendTitlePointPost(wire.url, wire.rawBody ?? '');

    let createResult: Awaited<ReturnType<typeof parseCreateServiceLiveResponse>>;
    try {
      createResult = await parseCreateServiceLiveResponse(http.body);
    } catch (parseErr) {
      const responseMeta = {
        ...buildResponseMeta(http.status, http.response.contentType, http.body),
        parseError: parseErr instanceof Error ? parseErr.message : 'parse failed',
      };
      await logRequest({
        operation: 'create_service',
        orderId,
        requestId,
        startedAt,
        success: false,
        httpStatus: http.status,
        errorCategory: 'XML_PARSE_ERROR',
        requestMeta: {
          ...extra,
          method: wire.method,
          url: wire.url,
          rawBody: wire.rawBody ?? null,
          contentType: wire.contentType ?? null,
        },
        responseMeta,
      });
      return vendorError(
        VENDOR,
        'CREATE_SERVICE_FAILED',
        `XML parse error (${responseMeta.isHtml ? 'HTML error page' : 'malformed XML'}) — see vendor_api_logs for raw response`,
        { requestId, durationMs: Date.now() - startedAt.getTime() },
      );
    }

    const returnStatus = createResult.returnStatus;
    const tpRequestId = createResult.requestId;
    const tpOrderId = createResult.orderId;

    if (returnStatus !== 'Success') {
      const errDesc = createResult.errorDescription || `TitlePoint returned ${returnStatus}`;
      await logRequest({
        operation: 'create_service',
        orderId,
        requestId,
        startedAt,
        success: false,
        httpStatus: http.status,
        errorCategory: 'TP_ERROR',
        requestMeta: {
          ...extra,
          method: wire.method,
          url: wire.url,
          rawBody: wire.rawBody ?? null,
          contentType: wire.contentType ?? null,
        },
        responseMeta: buildResponseMeta(http.status, http.response.contentType, http.body, {
          parsedRoot: 'CreateAsynchServicesReturn',
          returnStatus,
          error: errDesc,
        }),
      });
      return vendorError(VENDOR, 'CREATE_SERVICE_FAILED', errDesc, {
        requestId,
        durationMs: Date.now() - startedAt.getTime(),
      });
    }

    await logRequest({
      operation: 'create_service',
      orderId,
      requestId,
      startedAt,
      success: true,
      httpStatus: http.status,
      requestMeta: {
        ...extra,
        method: wire.method,
        url: wire.url,
        rawBody: wire.rawBody ?? null,
        contentType: wire.contentType ?? null,
      },
      responseMeta: buildResponseMeta(http.status, http.response.contentType, http.body, {
        parsedRoot: 'CreateAsynchServicesReturn',
        returnStatus,
        tpRequestId,
        tpOrderId,
      }),
    });

    return vendorSuccess(
      { requestId: tpRequestId, orderId: tpOrderId, returnStatus },
      { requestId, durationMs: Date.now() - startedAt.getTime() },
    );
  } catch (err) {
    await logUnhandledError({ operation: 'create_service', orderId, requestId, startedAt, wire, extra, err });
    const message = err instanceof Error ? err.message : 'Unknown error';
    return vendorError(VENDOR, 'CREATE_SERVICE_FAILED', message, {
      requestId,
      durationMs: Date.now() - startedAt.getTime(),
    });
  }
}

export async function createService(
  input: TitlePointCreateInput,
  orderId?: number,
): Promise<VendorResult<TitlePointCreateResponse>> {
  const cfg = getConfig();
  const requestId = `tp-${crypto.randomUUID()}`;
  const startedAt = new Date();

  if (!cfg) return mockCreateService(input, orderId, requestId, startedAt);

  const wire = input.searchType === 'geo_address'
    ? buildPostOrderGeoCreateServiceRequest(cfg, input)
    : input.searchType === 'tax'
      ? buildPostOrderTaxCreateServiceRequest(cfg, input)
      : buildPostOrderLvCreateServiceRequest(cfg, input);

  return runCreateService(wire, orderId, requestId, startedAt, {
    searchType: input.searchType,
    flow: 'post_order',
  });
}

export async function createServicePreOrderTax(
  input: TitlePointCreateInput,
  customerRef: string,
  orderId?: number,
): Promise<VendorResult<TitlePointCreateResponse>> {
  const cfg = getConfig();
  const requestId = `tp-${crypto.randomUUID()}`;
  const startedAt = new Date();

  if (!cfg) return mockCreateService(input, orderId, requestId, startedAt);

  const wire = buildPreOrderTaxCreateServiceRequest(cfg, input, customerRef);
  return runCreateService(wire, orderId, requestId, startedAt, {
    searchType: 'tax',
    flow: 'pre_order',
    customerRef,
  });
}

export async function createServicePreOrderLv(
  input: TitlePointCreateInput,
  includeAddressApn: boolean,
  customerRef: string,
  orderId?: number,
): Promise<VendorResult<TitlePointCreateResponse>> {
  const cfg = getConfig();
  const requestId = `tp-${crypto.randomUUID()}`;
  const startedAt = new Date();

  if (!cfg) return mockCreateService(input, orderId, requestId, startedAt);

  const wire = buildPreOrderLvCreateServiceRequest(cfg, input, includeAddressApn, customerRef);
  return runCreateService(wire, orderId, requestId, startedAt, {
    searchType: 'legal_vesting',
    flow: 'pre_order',
    customerRef,
    includeAddressApn,
  });
}

export async function getRequestSummaries(
  tpRequestId: string,
  orderId?: number,
): Promise<VendorResult<TitlePointSummaryResponse>> {
  const cfg = getConfig();
  const requestId = `tp-${crypto.randomUUID()}`;
  const startedAt = new Date();

  if (!cfg) return mockGetRequestSummaries(tpRequestId, orderId, requestId, startedAt);

  const wire = buildGetRequestSummariesRequest(cfg, tpRequestId);

  try {
    const http = await sendTitlePointGet(wire.url);

    let summaryResult: Awaited<ReturnType<typeof parseGetRequestSummariesLiveResponse>>;
    try {
      summaryResult = await parseGetRequestSummariesLiveResponse(http.body);
    } catch (parseErr) {
      await logRequest({
        operation: 'get_request_summaries',
        orderId,
        requestId,
        startedAt,
        success: false,
        httpStatus: http.status,
        errorCategory: 'XML_PARSE_ERROR',
        requestMeta: {
          tpRequestId,
          method: wire.method,
          url: wire.url,
          rawBody: null,
          contentType: null,
        },
        responseMeta: {
          ...buildResponseMeta(http.status, http.response.contentType, http.body),
          parseError: parseErr instanceof Error ? parseErr.message : 'parse failed',
        },
      });
      return vendorError(VENDOR, 'POLL_FAILED', 'XML parse error — see vendor_api_logs for raw response', {
        requestId,
        durationMs: Date.now() - startedAt.getTime(),
      });
    }

    const returnStatus = summaryResult.returnStatus;
    if (returnStatus !== 'Success') {
      const message = `Poll returned ${returnStatus}`;
      await logRequest({
        operation: 'get_request_summaries',
        orderId,
        requestId,
        startedAt,
        success: false,
        httpStatus: http.status,
        errorCategory: 'TP_POLL_ERROR',
        requestMeta: {
          tpRequestId,
          method: wire.method,
          url: wire.url,
          rawBody: null,
          contentType: null,
        },
        responseMeta: buildResponseMeta(http.status, http.response.contentType, http.body, {
          parsedRoot: 'GetRequestSummariesReturn',
          returnStatus,
        }),
      });
      return vendorError(VENDOR, 'POLL_FAILED', message, {
        requestId,
        durationMs: Date.now() - startedAt.getTime(),
      });
    }

    const response: TitlePointSummaryResponse = {
      status: summaryResult.status,
      serviceIds: summaryResult.serviceIds,
      resultIds: summaryResult.resultIds,
      message: summaryResult.message,
    };
    await logRequest({
      operation: 'get_request_summaries',
      orderId,
      requestId,
      startedAt,
      success: true,
      httpStatus: http.status,
      requestMeta: {
        tpRequestId,
        method: wire.method,
        url: wire.url,
        rawBody: null,
        contentType: null,
      },
      responseMeta: buildResponseMeta(http.status, http.response.contentType, http.body, {
        parsedRoot: 'GetRequestSummariesReturn',
        returnStatus,
        status: summaryResult.status,
        serviceCount: summaryResult.serviceIds.length,
        resultCount: summaryResult.resultIds.length,
      }),
    });
    return vendorSuccess(response, { requestId, durationMs: Date.now() - startedAt.getTime() });
  } catch (err) {
    await logUnhandledError({
      operation: 'get_request_summaries',
      orderId,
      requestId,
      startedAt,
      wire,
      extra: { tpRequestId },
      err,
    });
    const message = err instanceof Error ? err.message : 'Unknown error';
    return vendorError(VENDOR, 'POLL_FAILED', message, {
      requestId,
      durationMs: Date.now() - startedAt.getTime(),
    });
  }
}

export async function getResultByIdLv(
  resultId: string,
  orderId?: number,
): Promise<VendorResult<TitlePointResultResponse>> {
  const cfg = getConfig();
  const requestId = `tp-${crypto.randomUUID()}`;
  const startedAt = new Date();

  if (!cfg) return mockGetResult(resultId, orderId, requestId, startedAt);

  const wire = buildGetResultByIdRequest(cfg, resultId);

  try {
    const http = await sendTitlePointGet(wire.url);

    let result: Awaited<ReturnType<typeof parseLvGetResultLiveResponse>>;
    try {
      result = await parseLvGetResultLiveResponse(http.body);
    } catch (parseErr) {
      await logRequest({
        operation: 'get_result',
        orderId,
        requestId,
        startedAt,
        success: false,
        httpStatus: http.status,
        errorCategory: 'XML_PARSE_ERROR',
        requestMeta: { endpointKind: 'GetResultByID', method: wire.method, url: wire.url, rawBody: null, contentType: null, resultId },
        responseMeta: {
          ...buildResponseMeta(http.status, http.response.contentType, http.body),
          parseError: parseErr instanceof Error ? parseErr.message : 'parse failed',
        },
      });
      return vendorError(VENDOR, 'RESULT_FETCH_FAILED', 'XML parse error — see vendor_api_logs for raw response', {
        requestId,
        durationMs: Date.now() - startedAt.getTime(),
      });
    }

    const returnStatus = result.returnStatus;
    if (returnStatus !== 'Success') {
      const message = `TitlePoint returned ${returnStatus}`;
      await logRequest({
        operation: 'get_result',
        orderId,
        requestId,
        startedAt,
        success: false,
        httpStatus: http.status,
        errorCategory: 'TP_RESULT_ERROR',
        requestMeta: { endpointKind: 'GetResultByID', method: wire.method, url: wire.url, rawBody: null, contentType: null, resultId },
        responseMeta: buildResponseMeta(http.status, http.response.contentType, http.body, {
          parsedRoot: 'GetResultReturn',
          returnStatus,
        }),
      });
      return vendorError(VENDOR, 'RESULT_FETCH_FAILED', message, {
        requestId,
        durationMs: Date.now() - startedAt.getTime(),
      });
    }

    await logRequest({
      operation: 'get_result',
      orderId,
      requestId,
      startedAt,
      success: true,
      httpStatus: http.status,
      requestMeta: { endpointKind: 'GetResultByID', method: wire.method, url: wire.url, rawBody: null, contentType: null, resultId },
      responseMeta: buildResponseMeta(http.status, http.response.contentType, http.body, {
        parsedRoot: 'GetResultReturn',
        returnStatus,
      }),
    });

    return vendorSuccess({ serviceId: resultId, data: result.data, returnStatus }, {
      requestId,
      durationMs: Date.now() - startedAt.getTime(),
    });
  } catch (err) {
    await logUnhandledError({
      operation: 'get_result',
      orderId,
      requestId,
      startedAt,
      wire,
      extra: { endpointKind: 'GetResultByID', resultId },
      err,
    });
    const message = err instanceof Error ? err.message : 'Unknown error';
    return vendorError(VENDOR, 'RESULT_FETCH_FAILED', message, {
      requestId,
      durationMs: Date.now() - startedAt.getTime(),
    });
  }
}

export async function getResultById3Tax(
  resultId: string,
  orderId?: number,
): Promise<VendorResult<TitlePointResultResponse>> {
  const cfg = getConfig();
  const requestId = `tp-${crypto.randomUUID()}`;
  const startedAt = new Date();

  if (!cfg) return mockGetResult(resultId, orderId, requestId, startedAt);

  const wire = buildTaxGetResultById3Request(cfg, resultId);

  try {
    const http = await sendTitlePointGet(wire.url);

    let parsed: Record<string, unknown>;
    try {
      parsed = await parseXml(http.body);
    } catch (parseErr) {
      await logRequest({
        operation: 'get_result',
        orderId,
        requestId,
        startedAt,
        success: false,
        httpStatus: http.status,
        errorCategory: 'XML_PARSE_ERROR',
        requestMeta: { endpointKind: 'GetResultByID3', method: wire.method, url: wire.url, rawBody: wire.rawBody ?? null, contentType: wire.contentType ?? null, resultId, searchType: 'tax' },
        responseMeta: {
          ...buildResponseMeta(http.status, http.response.contentType, http.body),
          parseError: parseErr instanceof Error ? parseErr.message : 'parse failed',
        },
      });
      return vendorError(VENDOR, 'RESULT_FETCH_FAILED', 'XML parse error — see vendor_api_logs for raw response', {
        requestId,
        durationMs: Date.now() - startedAt.getTime(),
      });
    }

    const parsedRoot = parsed.GetResultReturn != null ? 'GetResultReturn' : 'ServiceResult';
    const root = ((parsed.GetResultReturn ?? parsed.ServiceResult) ?? {}) as Record<string, unknown>;
    const returnStatus = String(root.ReturnStatus ?? '');
    if (returnStatus !== 'Success') {
      const message = getServiceErrorDescription(root, `TitlePoint returned ${returnStatus}`);
      await logRequest({
        operation: 'get_result',
        orderId,
        requestId,
        startedAt,
        success: false,
        httpStatus: http.status,
        errorCategory: 'TP_RESULT_ERROR',
        requestMeta: { endpointKind: 'GetResultByID3', method: wire.method, url: wire.url, rawBody: wire.rawBody ?? null, contentType: wire.contentType ?? null, resultId, searchType: 'tax' },
        responseMeta: buildResponseMeta(http.status, http.response.contentType, http.body, {
          parsedRoot,
          returnStatus,
        }),
      });
      return vendorError(VENDOR, 'RESULT_FETCH_FAILED', message, {
        requestId,
        durationMs: Date.now() - startedAt.getTime(),
      });
    }

    const data = (root.Result ?? {}) as Record<string, unknown>;
    await logRequest({
      operation: 'get_result',
      orderId,
      requestId,
      startedAt,
      success: true,
      httpStatus: http.status,
      requestMeta: { endpointKind: 'GetResultByID3', method: wire.method, url: wire.url, rawBody: wire.rawBody ?? null, contentType: wire.contentType ?? null, resultId, searchType: 'tax' },
      responseMeta: buildResponseMeta(http.status, http.response.contentType, http.body, {
        parsedRoot,
        returnStatus,
      }),
    });

    return vendorSuccess({ serviceId: resultId, data, returnStatus }, {
      requestId,
      durationMs: Date.now() - startedAt.getTime(),
    });
  } catch (err) {
    await logUnhandledError({
      operation: 'get_result',
      orderId,
      requestId,
      startedAt,
      wire,
      extra: { endpointKind: 'GetResultByID3', resultId, searchType: 'tax' },
      err,
    });
    const message = err instanceof Error ? err.message : 'Unknown error';
    return vendorError(VENDOR, 'RESULT_FETCH_FAILED', message, {
      requestId,
      durationMs: Date.now() - startedAt.getTime(),
    });
  }
}

export async function getResultById3Geo(
  resultId: string,
  fileNumber?: string | null,
  orderId?: number,
): Promise<VendorResult<TitlePointResultResponse>> {
  const cfg = getConfig();
  const requestId = `tp-${crypto.randomUUID()}`;
  const startedAt = new Date();

  if (!cfg) return mockGetResult(resultId, orderId, requestId, startedAt);

  const getWire = buildGeoGetResultById3GetRequest(cfg, resultId);
  const postWire = buildGeoGetResultById3PostRequest(cfg, resultId);
  let rawArchiveKey: string | null = null;

  try {
    const rawHttp = await sendTitlePointGet(getWire.url);
    if (fileNumber) {
      const archiveKey = `lp-xml/${fileNumber}.xml`;
      const archiveResult = await uploadFile({
        key: archiveKey,
        buffer: Buffer.from(rawHttp.body, 'utf8'),
        contentType: 'application/xml',
      });
      if (archiveResult.success) {
        rawArchiveKey = archiveKey;
      }
    }

    await logRequest({
      operation: 'get_result_raw_xml',
      orderId,
      requestId,
      startedAt,
      success: true,
      httpStatus: rawHttp.status,
      requestMeta: {
        endpointKind: 'GetResultByID3',
        phase: 'geo_get_raw_xml',
        resultId,
        method: getWire.method,
        url: getWire.url,
        rawBody: null,
        contentType: null,
      },
      responseMeta: buildResponseMeta(rawHttp.status, rawHttp.response.contentType, rawHttp.body, {
        archivedTo: rawArchiveKey,
      }),
    });

    const parsedHttp = await sendTitlePointPost(postWire.url, postWire.rawBody ?? '');

    let parsed: Record<string, unknown>;
    try {
      parsed = await parseXml(parsedHttp.body);
    } catch (parseErr) {
      await logRequest({
        operation: 'get_result',
        orderId,
        requestId,
        startedAt,
        success: false,
        httpStatus: parsedHttp.status,
        errorCategory: 'XML_PARSE_ERROR',
        requestMeta: {
          endpointKind: 'GetResultByID3',
          phase: 'geo_post_parse',
          resultId,
          method: postWire.method,
          url: postWire.url,
          rawBody: postWire.rawBody ?? null,
          contentType: postWire.contentType ?? null,
        },
        responseMeta: {
          ...buildResponseMeta(parsedHttp.status, parsedHttp.response.contentType, parsedHttp.body),
          parseError: parseErr instanceof Error ? parseErr.message : 'parse failed',
          archivedTo: rawArchiveKey,
        },
      });
      return vendorError(VENDOR, 'RESULT_FETCH_FAILED', 'XML parse error — see vendor_api_logs for raw response', {
        requestId,
        durationMs: Date.now() - startedAt.getTime(),
      });
    }

    const parsedRoot = parsed.GetResultReturn != null ? 'GetResultReturn' : 'ServiceResult';
    const root = ((parsed.GetResultReturn ?? parsed.ServiceResult) ?? {}) as Record<string, unknown>;
    const returnStatus = String(root.ReturnStatus ?? '');
    if (returnStatus !== 'Success') {
      const message = getServiceErrorDescription(root, `TitlePoint returned ${returnStatus}`);
      await logRequest({
        operation: 'get_result',
        orderId,
        requestId,
        startedAt,
        success: false,
        httpStatus: parsedHttp.status,
        errorCategory: 'TP_RESULT_ERROR',
        requestMeta: {
          endpointKind: 'GetResultByID3',
          phase: 'geo_post_parse',
          resultId,
          method: postWire.method,
          url: postWire.url,
          rawBody: postWire.rawBody ?? null,
          contentType: postWire.contentType ?? null,
        },
        responseMeta: buildResponseMeta(parsedHttp.status, parsedHttp.response.contentType, parsedHttp.body, {
          parsedRoot,
          returnStatus,
          archivedTo: rawArchiveKey,
        }),
      });
      return vendorError(VENDOR, 'RESULT_FETCH_FAILED', message, {
        requestId,
        durationMs: Date.now() - startedAt.getTime(),
      });
    }

    const data = (root.Result ?? {}) as Record<string, unknown>;
    await logRequest({
      operation: 'get_result',
      orderId,
      requestId,
      startedAt,
      success: true,
      httpStatus: parsedHttp.status,
      requestMeta: {
        endpointKind: 'GetResultByID3',
        phase: 'geo_post_parse',
        resultId,
        method: postWire.method,
        url: postWire.url,
        rawBody: postWire.rawBody ?? null,
        contentType: postWire.contentType ?? null,
      },
      responseMeta: buildResponseMeta(parsedHttp.status, parsedHttp.response.contentType, parsedHttp.body, {
        parsedRoot,
        returnStatus,
        archivedTo: rawArchiveKey,
      }),
    });

    return vendorSuccess({ serviceId: resultId, data, returnStatus }, {
      requestId,
      durationMs: Date.now() - startedAt.getTime(),
    });
  } catch (err) {
    await logUnhandledError({
      operation: 'get_result',
      orderId,
      requestId,
      startedAt,
      wire: postWire,
      extra: { endpointKind: 'GetResultByID3', searchType: 'geo_address', resultId, rawArchiveKey },
      err,
    });
    const message = err instanceof Error ? err.message : 'Unknown error';
    return vendorError(VENDOR, 'RESULT_FETCH_FAILED', message, {
      requestId,
      durationMs: Date.now() - startedAt.getTime(),
    });
  }
}

export async function getResult(
  resultId: string,
  orderId?: number,
): Promise<VendorResult<TitlePointResultResponse>> {
  return getResultById3Tax(resultId, orderId);
}
