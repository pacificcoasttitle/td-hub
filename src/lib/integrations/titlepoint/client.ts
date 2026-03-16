import https from 'https';
import { parseStringPromise } from 'xml2js';
import { vendorSuccess, vendorError } from '@/lib/integrations/types';
import type { VendorResult } from '@/lib/integrations/types';
import type {
  TitlePointCreateInput,
  TitlePointCreateResponse,
  TitlePointSummaryResponse,
  TitlePointResultResponse,
  TitlePointImageResponse,
  TitlePointSearchType,
} from './types';
import { VENDOR, logRequest, MOCK_PDF_BASE64, pollCounts, delay } from './logging';

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

// ─── Raw HTTP Transport ─────────────────────────────────────────────────────
// TitlePoint's FortiWeb WAF blocks requests where special characters (#, ;)
// are URL-encoded. The legacy PHP sends a raw body via curl_post() with
// CURLOPT_POSTFIELDS as a string — characters like # ; and spaces are NOT
// encoded. Node's fetch/URLSearchParams always encodes them, triggering the
// WAF. We use Node https.request to send a truly raw body.

function rawPost(url: string, rawBody: string, timeoutMs = 30_000): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request({
      hostname: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : 443,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(rawBody),
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
    });
    req.on('error', reject);
    const timer = setTimeout(() => { req.destroy(); reject(new Error('TitlePoint request timeout')); }, timeoutMs);
    req.on('close', () => clearTimeout(timer));
    req.write(rawBody);
    req.end();
  });
}

function buildRawBody(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([key, value]) => `${key}=${value}`)
    .join('&') + '&';
}

// ─── XML Helpers ────────────────────────────────────────────────────────────

function dig(obj: unknown, ...keys: string[]): unknown {
  let current = obj;
  for (const key of keys) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function extractXmlResult(parsed: Record<string, unknown>, rootTag: string): Record<string, unknown> {
  const root = parsed[rootTag] ?? parsed;
  return (typeof root === 'object' && root !== null ? root : {}) as Record<string, unknown>;
}

// ─── Service Type Mapping ────────────────────────────────────────────────────

const SERVICE_TYPE_MAP: Record<TitlePointSearchType, string> = {
  geo_address: 'TitlePoint.Geo.Address',
  tax: 'TitlePoint.TaxSearch',
  legal_vesting: 'TitlePoint.LegalAndVesting2',
  grant_deed: 'TitlePoint.Geo.Address',
};

function buildParameters(input: TitlePointCreateInput): string {
  switch (input.searchType) {
    case 'tax':
      return [
        `APN=${input.fips ?? ''}`,
        'Property.AutoSearchTaxes=True',
        'Property.AutoSearchProperty=True',
      ].join(';');
    case 'legal_vesting':
      return [
        input.fips ? `FIPS=${input.fips}` : '',
        `APN=${input.fips ?? ''}`,
        `Address1=${input.address}`,
        `City=${input.city}`,
      ].filter(Boolean).join(';');
    default:
      return [
        `Address.FullAddress=${input.address}`,
        'General.AutoSearchTaxes=False',
        'Tax.CurrentYearTaxesOnly=False',
        'General.AutoSearchProperty=True',
        'General.AutoSearchOwnerNames=False',
        'General.AutoSearchStarters=False',
        'Property.IntelligentPropertyGrouping=true',
      ].join(';') + ';';
  }
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
      userID: cfg.userID,
      password: cfg.password,
      serviceType: SERVICE_TYPE_MAP[input.searchType],
      parameters: buildParameters(input),
      department: '',
      orderNo: orderId ? String(orderId) : '',
      customerRef: '',
      company: '',
      titleOfficer: '',
      orderComment: '',
      starterRemarks: '',
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
      const errDesc = String(
        dig(result, 'ReturnErrors', 'ReturnError', 'ErrorDescription') ??
        result.Message ?? `TitlePoint returned ${returnStatus}`
      );
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
      userID: cfg.userID,
      password: cfg.password,
      requestID: tpRequestId,
      company: '',
      department: '',
      titleOfficer: '',
      maxWaitSeconds: '15',
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
        }
        const directSid = String(dig(s, 'ServiceID') ?? '');
        if (directSid && !serviceIds.includes(directSid)) serviceIds.push(directSid);
      } else if (st === 'failed' || st === 'error') {
        status = 'failed';
        message = String(dig(s, 'Message') ?? dig(s, 'ErrorDescription') ?? 'Search failed');
      }
    }

    const response: TitlePointSummaryResponse = { status, serviceIds, message };
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
      userID: cfg.userID,
      password: cfg.password,
      serviceID: serviceId,
      company: '',
      department: '',
      titleOfficer: '',
    }));
    const parsed = await parseStringPromise(xml, { explicitArray: false, ignoreAttrs: true });
    const result = extractXmlResult(parsed, 'GetResultByID3Return') as Record<string, unknown>;

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
      userID: cfg.userID,
      password: cfg.password,
      serviceId1: serviceId,
      fileType: 'pdf',
      company: '',
      department: '',
      titleOfficer: '',
    }));
    const parsed = await parseStringPromise(xml, { explicitArray: false, ignoreAttrs: true });
    const result = extractXmlResult(parsed, 'CreateRequest3Return') as Record<string, unknown>;

    const returnStatus = String(result.ReturnStatus ?? '');
    const imgRequestId = String(result.RequestID ?? '');
    const imgOrderId = String(result.OrderID ?? '');

    if (returnStatus !== 'Success' || !imgRequestId) {
      const msg = String(dig(result, 'ReturnErrors', 'ReturnError', 'ErrorDescription') ?? 'Image request failed');
      await logRequest({ operation: 'request_image', orderId, requestId, startedAt, success: false, httpStatus, errorCategory: 'TP_IMAGE_ERROR', requestMeta: { serviceId } });
      return vendorError(VENDOR, 'IMAGE_REQUEST_FAILED', msg, { requestId, durationMs: Date.now() - startedAt.getTime() });
    }

    await logRequest({ operation: 'request_image', orderId, requestId, startedAt, success: true, httpStatus, requestMeta: { serviceId }, responseMeta: { imgRequestId } });
    return vendorSuccess(
      { requestId: imgRequestId, orderId: imgOrderId },
      { requestId, durationMs: Date.now() - startedAt.getTime() }
    );
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

  try {
    const url = `${cfg.baseUrl}${TP_ENDPOINTS.getGeneratedImage}?`;
    const { status: httpStatus, body: xml } = await rawPost(url, buildRawBody({
      userID: cfg.userID,
      password: cfg.password,
      requestID: imgRequestId,
      company: '',
      department: '',
      titleOfficer: '',
    }));
    const parsed = await parseStringPromise(xml, { explicitArray: false, ignoreAttrs: true });
    const result = extractXmlResult(parsed, 'GetGeneratedImageReturn') as Record<string, unknown>;

    const returnStatus = String(result.ReturnStatus ?? '');
    const base64Data = String(
      result.Base64Data ?? result.ImageData ?? result.FileData ?? ''
    );
    const imgStatus = String(result.Status ?? returnStatus);

    if (!base64Data) {
      await logRequest({ operation: 'get_image', orderId, requestId, startedAt, success: false, httpStatus, errorCategory: 'TP_NO_IMAGE', requestMeta: { imgRequestId } });
      return vendorError(VENDOR, 'IMAGE_FETCH_FAILED', 'No image data in response', { requestId, durationMs: Date.now() - startedAt.getTime() });
    }

    const response: TitlePointImageResponse = { base64Data, status: imgStatus, returnStatus };
    await logRequest({ operation: 'get_image', orderId, requestId, startedAt, success: true, httpStatus, requestMeta: { imgRequestId }, responseMeta: { size: base64Data.length } });
    return vendorSuccess(response, { requestId, durationMs: Date.now() - startedAt.getTime() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    await logRequest({ operation: 'get_image', orderId, requestId, startedAt, success: false, errorCategory: 'image_fetch_failed' });
    return vendorError(VENDOR, 'IMAGE_FETCH_FAILED', msg, { requestId, durationMs: Date.now() - startedAt.getTime() });
  }
}

// ─── Mock Fallbacks ─────────────────────────────────────────────────────────

async function mockCreateService(
  input: TitlePointCreateInput, orderId: number | undefined, requestId: string, startedAt: Date,
): Promise<VendorResult<TitlePointCreateResponse>> {
  await delay(40);
  const tpRequestId = `REQ-${Date.now()}`;
  const tpOrderId = `ORD-${Date.now()}`;
  await logRequest({ operation: 'create_service', orderId, requestId, startedAt, success: true, httpStatus: 200, requestMeta: { searchType: input.searchType, address: input.address, mock: true }, responseMeta: { tpRequestId, tpOrderId } });
  return vendorSuccess<TitlePointCreateResponse>(
    { requestId: tpRequestId, orderId: tpOrderId, returnStatus: 'OK' },
    { requestId, durationMs: Date.now() - startedAt.getTime() }
  );
}

async function mockGetRequestSummaries(
  tpRequestId: string, orderId: number | undefined, requestId: string, startedAt: Date,
): Promise<VendorResult<TitlePointSummaryResponse>> {
  await delay(30);
  const count = (pollCounts.get(tpRequestId) ?? 0) + 1;
  pollCounts.set(tpRequestId, count);
  const isPending = count === 1;
  const response: TitlePointSummaryResponse = isPending
    ? { status: 'pending', serviceIds: [], message: 'Processing...' }
    : { status: 'success', serviceIds: [`SVC-${tpRequestId}-001`] };
  if (!isPending) pollCounts.delete(tpRequestId);
  await logRequest({ operation: 'get_request_summaries', orderId, requestId, startedAt, success: true, httpStatus: 200, requestMeta: { tpRequestId, pollCount: count, mock: true }, responseMeta: { status: response.status, serviceCount: response.serviceIds.length } });
  return vendorSuccess(response, { requestId, durationMs: Date.now() - startedAt.getTime() });
}

async function mockGetResult(
  serviceId: string, orderId: number | undefined, requestId: string, startedAt: Date,
): Promise<VendorResult<TitlePointResultResponse>> {
  await delay(30);
  const response: TitlePointResultResponse = {
    serviceId,
    data: { propertyAddress: '123 Main St', city: 'Glendale', state: 'CA', zip: '91203', owner: 'John Doe & Jane Doe', legalDescription: 'Lot 1, Block A, Tract 12345', apn: '5678-001-001' },
    returnStatus: 'Success',
  };
  await logRequest({ operation: 'get_result', orderId, requestId, startedAt, success: true, httpStatus: 200, requestMeta: { serviceId, mock: true } });
  return vendorSuccess(response, { requestId, durationMs: Date.now() - startedAt.getTime() });
}

async function mockRequestImage(
  serviceId: string, orderId: number | undefined, requestId: string, startedAt: Date,
): Promise<VendorResult<{ requestId: string; orderId: string }>> {
  await delay(20);
  const imgRequestId = `IMG-${Date.now()}`;
  const imgOrderId = `IORD-${Date.now()}`;
  await logRequest({ operation: 'request_image', orderId, requestId, startedAt, success: true, httpStatus: 200, requestMeta: { serviceId, mock: true }, responseMeta: { imgRequestId } });
  return vendorSuccess({ requestId: imgRequestId, orderId: imgOrderId }, { requestId, durationMs: Date.now() - startedAt.getTime() });
}

async function mockGetImage(
  imgRequestId: string, orderId: number | undefined, requestId: string, startedAt: Date,
): Promise<VendorResult<TitlePointImageResponse>> {
  await delay(30);
  const response: TitlePointImageResponse = { base64Data: MOCK_PDF_BASE64, status: 'Success', returnStatus: 'OK' };
  await logRequest({ operation: 'get_image', orderId, requestId, startedAt, success: true, httpStatus: 200, requestMeta: { imgRequestId, mock: true } });
  return vendorSuccess(response, { requestId, durationMs: Date.now() - startedAt.getTime() });
}
