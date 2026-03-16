import { parseStringPromise } from 'xml2js';
import { vendorSuccess, vendorError } from '@/lib/integrations/types';
import type { VendorResult } from '@/lib/integrations/types';
import type {
  TitlePointCreateInput, TitlePointCreateResponse,
  TitlePointSummaryResponse, TitlePointResultResponse,
  TitlePointImageResponse,
} from './types';
import { VENDOR, logRequest } from './logging';
import { rawPost, buildRawBody, dig, extractXmlResult } from './http';
import { SERVICE_TYPE_MAP, buildParameters } from './params';
import {
  mockCreateService, mockGetRequestSummaries, mockGetResult,
  mockRequestImage, mockGetImage,
} from './mocks';

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
    baseUrl: baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`,
    userID: process.env.TP_USERNAME ?? '',
    password: process.env.TP_PASSWORD ?? '',
  };
}

// ─── CreateService ───────────────────────────────────────────────────────────

export async function createService(
  input: TitlePointCreateInput,
  orderId?: number
): Promise<VendorResult<TitlePointCreateResponse>> {
  const cfg = getConfig();
  const requestId = `tp-${crypto.randomUUID()}`;
  const startedAt = new Date();

  if (!cfg) return mockCreateService(input, orderId, requestId, startedAt);

  const isLV = input.searchType === 'legal_vesting';
  const endpoint = isLV ? TP_ENDPOINTS.createService4 : TP_ENDPOINTS.createService3;

  try {
    const params: Record<string, string> = {
      userID: cfg.userID, password: cfg.password,
      serviceType: SERVICE_TYPE_MAP[input.searchType],
      parameters: buildParameters(input),
      department: '', orderNo: '', customerRef: orderId ? String(orderId) : '',
      company: '', titleOfficer: '', orderComment: '', starterRemarks: '',
    };

    if (isLV) {
      params.fipsCode = input.fips ?? '';
    } else {
      params.state = input.state;
      params.county = input.county ?? '';
    }

    const url = `${cfg.baseUrl}${endpoint}?`;
    const { status: httpStatus, body: xml } = await rawPost(url, buildRawBody(params));
    const parsed = await parseStringPromise(xml, { explicitArray: false, ignoreAttrs: true });
    const result = extractXmlResult(parsed, 'CreateAsynchServicesReturn');

    const returnStatus = String(result.ReturnStatus ?? '');
    const tpRequestId = String(result.RequestID ?? '');
    const tpOrderId = String(result.OrderID ?? '');

    if (returnStatus !== 'Success') {
      const errDesc = String(dig(result, 'ReturnErrors', 'ReturnError', 'ErrorDescription') ?? result.Message ?? `TitlePoint returned ${returnStatus}`);
      await logRequest({ operation: 'create_service', orderId, requestId, startedAt, success: false, httpStatus, errorCategory: 'TP_ERROR', requestMeta: { searchType: input.searchType, endpoint }, responseMeta: { returnStatus, error: errDesc } });
      return vendorError(VENDOR, 'CREATE_SERVICE_FAILED', errDesc, { requestId, durationMs: Date.now() - startedAt.getTime() });
    }

    await logRequest({ operation: 'create_service', orderId, requestId, startedAt, success: true, httpStatus, requestMeta: { searchType: input.searchType, endpoint, address: input.address }, responseMeta: { tpRequestId, tpOrderId } });
    return vendorSuccess<TitlePointCreateResponse>(
      { requestId: tpRequestId, orderId: tpOrderId, returnStatus },
      { requestId, durationMs: Date.now() - startedAt.getTime() }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    await logRequest({ operation: 'create_service', orderId, requestId, startedAt, success: false, errorCategory: 'create_failed', requestMeta: { endpoint } });
    return vendorError(VENDOR, 'CREATE_SERVICE_FAILED', msg, { requestId, durationMs: Date.now() - startedAt.getTime() });
  }
}

// ─── GetRequestSummaries ────────────────────────────────────────────────────

export async function getRequestSummaries(
  tpRequestId: string,
  orderId?: number
): Promise<VendorResult<TitlePointSummaryResponse>> {
  const cfg = getConfig();
  const requestId = `tp-${crypto.randomUUID()}`;
  const startedAt = new Date();

  if (!cfg) return mockGetRequestSummaries(tpRequestId, orderId, requestId, startedAt);

  try {
    const url = `${cfg.baseUrl}${TP_ENDPOINTS.getRequestSummaries}?`;
    const { status: httpStatus, body: xml } = await rawPost(url, buildRawBody({
      userID: cfg.userID, password: cfg.password,
      requestID: tpRequestId, company: '', department: '', titleOfficer: '', maxWaitSeconds: '15',
    }));
    const parsed = await parseStringPromise(xml, { explicitArray: false, ignoreAttrs: true });
    const result = extractXmlResult(parsed, 'GetRequestSummariesReturn');

    const returnStatus = String(result.ReturnStatus ?? '');
    if (returnStatus !== 'Success') {
      const msg = String(dig(result, 'ReturnErrors', 'ReturnError', 'ErrorDescription') ?? `Poll returned ${returnStatus}`);
      await logRequest({ operation: 'get_request_summaries', orderId, requestId, startedAt, success: false, httpStatus, errorCategory: 'TP_POLL_ERROR', requestMeta: { tpRequestId }, responseMeta: { returnStatus } });
      return vendorError(VENDOR, 'POLL_FAILED', msg, { requestId, durationMs: Date.now() - startedAt.getTime() });
    }

    const summaries = result.RequestSummaries;
    const summaryNode = dig(summaries, 'RequestSummary') ?? summaries;
    const summaryList = Array.isArray(summaryNode) ? summaryNode : summaryNode ? [summaryNode] : [];

    let status: 'pending' | 'success' | 'failed' = 'pending';
    const serviceIds: string[] = [];
    const resultIds: string[] = [];
    let message: string | undefined;

    for (const s of summaryList) {
      const st = String(dig(s, 'Status') ?? '').toLowerCase();
      if (st === 'complete' || st === 'completed' || st === 'success') {
        status = 'success';
        const order = dig(s, 'Order') as Record<string, unknown> | undefined;
        const services = dig(order ?? s, 'Services', 'Service');
        const svcList = Array.isArray(services) ? services : services ? [services] : [];
        for (const svc of svcList) {
          const sid = typeof svc === 'string' ? svc : String(dig(svc, 'ID') ?? dig(svc, 'ServiceID') ?? '');
          if (sid) serviceIds.push(sid);
          const thumbs = dig(svc, 'ThumbNails', 'ResultThumbNail');
          const thumbList = Array.isArray(thumbs) ? thumbs : thumbs ? [thumbs] : [];
          for (const t of thumbList) {
            const rid = String(dig(t, 'ID') ?? '');
            if (rid && rid !== '0') resultIds.push(rid);
          }
        }
        const directSid = String(dig(s, 'ServiceID') ?? '');
        if (directSid && !serviceIds.includes(directSid)) serviceIds.push(directSid);
      } else if (st === 'failed' || st === 'error') {
        status = 'failed';
        message = String(dig(s, 'Message') ?? dig(s, 'ErrorDescription') ?? 'Search failed');
      }
    }

    const response: TitlePointSummaryResponse = { status, serviceIds, resultIds, message };
    await logRequest({ operation: 'get_request_summaries', orderId, requestId, startedAt, success: true, httpStatus, requestMeta: { tpRequestId }, responseMeta: { status, serviceCount: serviceIds.length } });
    return vendorSuccess(response, { requestId, durationMs: Date.now() - startedAt.getTime() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    await logRequest({ operation: 'get_request_summaries', orderId, requestId, startedAt, success: false, errorCategory: 'poll_failed' });
    return vendorError(VENDOR, 'POLL_FAILED', msg, { requestId, durationMs: Date.now() - startedAt.getTime() });
  }
}

// ─── GetResultByID3 ─────────────────────────────────────────────────────────

export async function getResult(
  serviceId: string,
  orderId?: number
): Promise<VendorResult<TitlePointResultResponse>> {
  const cfg = getConfig();
  const requestId = `tp-${crypto.randomUUID()}`;
  const startedAt = new Date();

  if (!cfg) return mockGetResult(serviceId, orderId, requestId, startedAt);

  try {
    const url = `${cfg.baseUrl}${TP_ENDPOINTS.getResultById3}?`;
    const { status: httpStatus, body: xml } = await rawPost(url, buildRawBody({
      userID: cfg.userID, password: cfg.password,
      resultID: serviceId, requestingTPXML: 'true', company: '', department: '', titleOfficer: '',
    }));
    const parsed = await parseStringPromise(xml, { explicitArray: false, ignoreAttrs: true });
    const result = extractXmlResult(parsed, 'GetResultReturn', 'GetResultByID3Return') as Record<string, unknown>;

    const returnStatus = String(result.ReturnStatus ?? '');
    const resultData = (result.ResultData ?? result.ServiceResult ?? result) as Record<string, unknown>;

    const response: TitlePointResultResponse = { serviceId, data: resultData, returnStatus };
    await logRequest({ operation: 'get_result', orderId, requestId, startedAt, success: true, httpStatus, requestMeta: { serviceId } });
    return vendorSuccess(response, { requestId, durationMs: Date.now() - startedAt.getTime() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    await logRequest({ operation: 'get_result', orderId, requestId, startedAt, success: false, errorCategory: 'result_fetch_failed' });
    return vendorError(VENDOR, 'RESULT_FETCH_FAILED', msg, { requestId, durationMs: Date.now() - startedAt.getTime() });
  }
}

// ─── Image Request ──────────────────────────────────────────────────────────

export async function requestImage(
  serviceId: string,
  orderId?: number
): Promise<VendorResult<{ requestId: string; orderId: string }>> {
  const cfg = getConfig();
  const requestId = `tp-${crypto.randomUUID()}`;
  const startedAt = new Date();

  if (!cfg) return mockRequestImage(serviceId, orderId, requestId, startedAt);

  try {
    const url = `${cfg.baseUrl}${TP_ENDPOINTS.createRequest3}?`;
    const { status: httpStatus, body: xml } = await rawPost(url, buildRawBody({
      username: cfg.userID, password: cfg.password,
      serviceId1: serviceId, fileType: 'pdf', source: '', clientKey1: '', clientKey2: '',
      sortOrder: '', serviceId2: '', serviceId3: '', serviceId4: '', serviceId5: '',
    }));
    const parsed = await parseStringPromise(xml, { explicitArray: false, ignoreAttrs: true });
    const result = extractXmlResult(parsed, 'CreateAsynchServicesReturn', 'CreateRequest3Return') as Record<string, unknown>;

    const returnStatus = String(result.ReturnStatus ?? '');
    const imgRequestId = String(result.RequestID ?? '');
    const imgOrderId = String(result.OrderID ?? '');

    if (returnStatus !== 'Success' || !imgRequestId) {
      const msg = String(dig(result, 'ReturnErrors', 'ReturnError', 'ErrorDescription') ?? 'Image request failed');
      await logRequest({ operation: 'request_image', orderId, requestId, startedAt, success: false, httpStatus, errorCategory: 'TP_IMAGE_ERROR', requestMeta: { serviceId } });
      return vendorError(VENDOR, 'IMAGE_REQUEST_FAILED', msg, { requestId, durationMs: Date.now() - startedAt.getTime() });
    }

    await logRequest({ operation: 'request_image', orderId, requestId, startedAt, success: true, httpStatus, requestMeta: { serviceId }, responseMeta: { imgRequestId } });
    return vendorSuccess({ requestId: imgRequestId, orderId: imgOrderId }, { requestId, durationMs: Date.now() - startedAt.getTime() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    await logRequest({ operation: 'request_image', orderId, requestId, startedAt, success: false, errorCategory: 'image_request_failed' });
    return vendorError(VENDOR, 'IMAGE_REQUEST_FAILED', msg, { requestId, durationMs: Date.now() - startedAt.getTime() });
  }
}

// ─── Image Retrieval ────────────────────────────────────────────────────────

export async function getImage(
  imgRequestId: string,
  orderId?: number
): Promise<VendorResult<TitlePointImageResponse>> {
  const cfg = getConfig();
  const requestId = `tp-${crypto.randomUUID()}`;
  const startedAt = new Date();

  if (!cfg) return mockGetImage(imgRequestId, orderId, requestId, startedAt);

  const MAX_POLLS = 10;
  const POLL_INTERVAL_MS = 5_000;

  try {
    const url = `${cfg.baseUrl}${TP_ENDPOINTS.getGeneratedImage}?`;
    const body = buildRawBody({ username: cfg.userID, password: cfg.password, requestID: imgRequestId });

    for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
      const { status: httpStatus, body: xml } = await rawPost(url, body);
      const parsed = await parseStringPromise(xml, { explicitArray: false, ignoreAttrs: true });
      const result = extractXmlResult(parsed, 'GenerateImageData', 'GetGeneratedImageReturn') as Record<string, unknown>;

      const returnStatus = String(result.ReturnStatus ?? '');
      const imgStatus = String(result.Status ?? returnStatus).toLowerCase();

      if (imgStatus === 'processing' || imgStatus === 'pending') {
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
        continue;
      }

      if (returnStatus !== 'Success') {
        const msg = String(dig(result, 'ReturnErrors', 'ReturnError', 'ErrorDescription') ?? `Image generation returned ${returnStatus}`);
        await logRequest({ operation: 'get_image', orderId, requestId, startedAt, success: false, httpStatus, errorCategory: 'TP_IMAGE_ERROR', requestMeta: { imgRequestId } });
        return vendorError(VENDOR, 'IMAGE_FETCH_FAILED', msg, { requestId, durationMs: Date.now() - startedAt.getTime() });
      }

      const docs = dig(result, 'Documents', 'DocumentResponse', 'Document');
      const docNode = Array.isArray(docs) ? docs[0] : docs;
      const base64Data = String(dig(docNode, 'Body', 'Data') ?? dig(docNode, 'Body', 'Body') ?? result.Data ?? result.Base64Data ?? result.ImageData ?? '');

      if (!base64Data) {
        await logRequest({ operation: 'get_image', orderId, requestId, startedAt, success: false, httpStatus, errorCategory: 'TP_NO_IMAGE', requestMeta: { imgRequestId } });
        return vendorError(VENDOR, 'IMAGE_FETCH_FAILED', 'No image data in response', { requestId, durationMs: Date.now() - startedAt.getTime() });
      }

      const response: TitlePointImageResponse = { base64Data, status: imgStatus, returnStatus };
      await logRequest({ operation: 'get_image', orderId, requestId, startedAt, success: true, httpStatus, requestMeta: { imgRequestId }, responseMeta: { size: base64Data.length } });
      return vendorSuccess(response, { requestId, durationMs: Date.now() - startedAt.getTime() });
    }

    await logRequest({ operation: 'get_image', orderId, requestId, startedAt, success: false, errorCategory: 'TP_IMAGE_TIMEOUT', requestMeta: { imgRequestId } });
    return vendorError(VENDOR, 'IMAGE_FETCH_FAILED', `Image generation timed out after ${MAX_POLLS} polls`, { requestId, durationMs: Date.now() - startedAt.getTime() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    await logRequest({ operation: 'get_image', orderId, requestId, startedAt, success: false, errorCategory: 'image_fetch_failed' });
    return vendorError(VENDOR, 'IMAGE_FETCH_FAILED', msg, { requestId, durationMs: Date.now() - startedAt.getTime() });
  }
}

