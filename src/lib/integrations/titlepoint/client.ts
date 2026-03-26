import { parseStringPromise } from 'xml2js';
import { vendorSuccess, vendorError } from '@/lib/integrations/types';
import type { VendorResult } from '@/lib/integrations/types';
import type {
  TitlePointCreateInput, TitlePointCreateResponse,
  TitlePointSummaryResponse, TitlePointResultResponse,
} from './types';
import { VENDOR, logRequest } from './logging';
import { tpPostRawForm, dig, extractXmlResult } from './http';
import { SERVICE_TYPE_MAP, buildParameters } from './params';
import { mockCreateService, mockGetRequestSummaries, mockGetResult } from './mocks';

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
// Legacy: Titlepoint.php generateGeoDoc() line 464-488 (POST via curl_post)
// Legacy: frontend TitlePoint.php createService() (GET via file_get_contents)
// TD Hub uses POST (library path) for all post-order automation.

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
    // Base params matching legacy array order from Titlepoint.php line 464-481
    const params: Record<string, string> = {
      userID: cfg.userID,
      password: cfg.password,
      serviceType: SERVICE_TYPE_MAP[input.searchType],
      parameters: buildParameters(input),
      department: '',
      orderNo: '',
      customerRef: orderId ? String(orderId) : '',
      company: '',
      titleOfficer: '',
      orderComment: '',
      starterRemarks: '',
    };

    if (isLV) {
      // LV uses fipsCode, no state/county
      params.fipsCode = input.fips ?? '';
    } else {
      // Geo and Tax use state + county
      params.state = input.state;
      params.county = input.county ?? '';
    }

    const url = `${cfg.baseUrl}${endpoint}`;
    const { status: httpStatus, body: xml } = await tpPostRawForm(url, params);

    let parsed: Record<string, unknown>;
    try {
      parsed = await parseStringPromise(xml, { explicitArray: false, ignoreAttrs: true });
    } catch (parseErr) {
      const snippet = xml.slice(0, 3000);
      const isHtml = /<html/i.test(snippet);
      await logRequest({ operation: 'create_service', orderId, requestId, startedAt, success: false, httpStatus, errorCategory: 'XML_PARSE_ERROR', requestMeta: { searchType: input.searchType, endpoint }, responseMeta: { rawSnippet: snippet, isHtml, parseError: parseErr instanceof Error ? parseErr.message : 'parse failed' } });
      return vendorError(VENDOR, 'CREATE_SERVICE_FAILED', `XML parse error (${isHtml ? 'HTML error page' : 'malformed XML'}) — see vendor_api_logs for raw response`, { requestId, durationMs: Date.now() - startedAt.getTime() });
    }

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
// Legacy: Titlepoint.php getGeoImageRequestStatus() line 1428-1478 (POST via curl_post)
// Param order matches legacy line 1431-1438.
// FIXES: requestId (lowercase d), maxWaitSeconds=20

export async function getRequestSummaries(
  tpRequestId: string,
  orderId?: number
): Promise<VendorResult<TitlePointSummaryResponse>> {
  const cfg = getConfig();
  const requestId = `tp-${crypto.randomUUID()}`;
  const startedAt = new Date();

  if (!cfg) return mockGetRequestSummaries(tpRequestId, orderId, requestId, startedAt);

  try {
    const url = `${cfg.baseUrl}${TP_ENDPOINTS.getRequestSummaries}`;
    const { status: httpStatus, body: xml } = await tpPostRawForm(url, {
      userID: cfg.userID,
      password: cfg.password,
      company: '',
      department: '',
      titleOfficer: '',
      requestId: tpRequestId,
      maxWaitSeconds: '20',
    });

    let parsed: Record<string, unknown>;
    try {
      parsed = await parseStringPromise(xml, { explicitArray: false, ignoreAttrs: true });
    } catch (parseErr) {
      const snippet = xml.slice(0, 500);
      await logRequest({ operation: 'get_request_summaries', orderId, requestId, startedAt, success: false, httpStatus, errorCategory: 'XML_PARSE_ERROR', requestMeta: { tpRequestId }, responseMeta: { rawSnippet: snippet, parseError: parseErr instanceof Error ? parseErr.message : 'parse failed' } });
      return vendorError(VENDOR, 'POLL_FAILED', 'XML parse error — see vendor_api_logs for raw response', { requestId, durationMs: Date.now() - startedAt.getTime() });
    }

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
// Legacy: Titlepoint.php generateGeoDocument() line 1150-1176 (POST via curl_post)
// Param order matches legacy line 1150-1157.

export async function getResult(
  serviceId: string,
  orderId?: number
): Promise<VendorResult<TitlePointResultResponse>> {
  const cfg = getConfig();
  const requestId = `tp-${crypto.randomUUID()}`;
  const startedAt = new Date();

  if (!cfg) return mockGetResult(serviceId, orderId, requestId, startedAt);

  try {
    const url = `${cfg.baseUrl}${TP_ENDPOINTS.getResultById3}`;
    const { status: httpStatus, body: xml } = await tpPostRawForm(url, {
      userID: cfg.userID,
      password: cfg.password,
      company: '',
      department: '',
      titleOfficer: '',
      requestingTPXML: 'true',
      resultID: serviceId,
    });

    let parsed: Record<string, unknown>;
    try {
      parsed = await parseStringPromise(xml, { explicitArray: false, ignoreAttrs: true });
    } catch (parseErr) {
      const snippet = xml.slice(0, 500);
      await logRequest({ operation: 'get_result', orderId, requestId, startedAt, success: false, httpStatus, errorCategory: 'XML_PARSE_ERROR', requestMeta: { serviceId }, responseMeta: { rawSnippet: snippet, parseError: parseErr instanceof Error ? parseErr.message : 'parse failed' } });
      return vendorError(VENDOR, 'RESULT_FETCH_FAILED', 'XML parse error — see vendor_api_logs for raw response', { requestId, durationMs: Date.now() - startedAt.getTime() });
    }

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
