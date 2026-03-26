import { parseStringPromise } from 'xml2js';
import { vendorSuccess, vendorError } from '@/lib/integrations/types';
import type { VendorResult } from '@/lib/integrations/types';
import type { TitlePointImageResponse, TitlePointDocumentResponse } from './types';
import { VENDOR, logRequest } from './logging';
import { tpPostRawForm, dig, extractXmlResult } from './http';
import { buildGrantDeedParameters } from './params';
import { mockRequestImage, mockGetImage } from './mocks';
import { TP_ENDPOINTS } from './client';

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

// ─── CreateRequest3 (Image Request) ─────────────────────────────────────────
// Legacy: Titlepoint.php generateImg() line 39-49 (POST via curl_post)
// FIXES: removed serviceId3/4/5 (not in legacy), param order matches legacy

export async function requestImage(
  serviceId: string,
  orderId?: number
): Promise<VendorResult<{ requestId: string; orderId: string }>> {
  const cfg = getConfig();
  const requestId = `tp-${crypto.randomUUID()}`;
  const startedAt = new Date();

  if (!cfg) return mockRequestImage(serviceId, orderId, requestId, startedAt);

  try {
    const url = `${cfg.baseUrl}${TP_ENDPOINTS.createRequest3}`;
    const { status: httpStatus, body: xml } = await tpPostRawForm(url, {
      username: cfg.userID,
      password: cfg.password,
      serviceId1: serviceId,
      serviceId2: '',
      source: '',
      clientKey1: '',
      clientKey2: '',
      sortOrder: '',
      fileType: 'pdf',
    });

    let parsed: Record<string, unknown>;
    try {
      parsed = await parseStringPromise(xml, { explicitArray: false, ignoreAttrs: true });
    } catch (parseErr) {
      const snippet = xml.slice(0, 500);
      await logRequest({ operation: 'request_image', orderId, requestId, startedAt, success: false, httpStatus, errorCategory: 'XML_PARSE_ERROR', requestMeta: { serviceId }, responseMeta: { rawSnippet: snippet, parseError: parseErr instanceof Error ? parseErr.message : 'parse failed' } });
      return vendorError(VENDOR, 'IMAGE_REQUEST_FAILED', 'XML parse error — see vendor_api_logs for raw response', { requestId, durationMs: Date.now() - startedAt.getTime() });
    }

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

// ─── GetRequestStatus (Image Status Poll) ───────────────────────────────────
// Legacy: Titlepoint.php getImageRequestStatus() line 929-974 (POST via curl_post)
// The legacy calls this BEFORE GetGeneratedImage. We reintroduce this step.
// FIXES: requestId (lowercase d), uses 'username' not 'userID'

export async function getRequestStatus(
  imgRequestId: string,
  orderId?: number
): Promise<VendorResult<{ status: string; returnStatus: string }>> {
  const cfg = getConfig();
  const requestId = `tp-${crypto.randomUUID()}`;
  const startedAt = new Date();

  if (!cfg) {
    return vendorSuccess({ status: 'success', returnStatus: 'Success' }, { requestId, durationMs: 0 });
  }

  const MAX_POLLS = 4;

  try {
    const url = `${cfg.baseUrl}${TP_ENDPOINTS.getRequestStatus}`;

    for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
      const { status: httpStatus, body: xml } = await tpPostRawForm(url, {
        username: cfg.userID,
        password: cfg.password,
        requestId: imgRequestId,
      });

      let parsed: Record<string, unknown>;
      try {
        parsed = await parseStringPromise(xml, { explicitArray: false, ignoreAttrs: true });
      } catch (parseErr) {
        const snippet = xml.slice(0, 500);
        await logRequest({ operation: 'get_request_status', orderId, requestId, startedAt, success: false, httpStatus, errorCategory: 'XML_PARSE_ERROR', requestMeta: { imgRequestId, attempt }, responseMeta: { rawSnippet: snippet, parseError: parseErr instanceof Error ? parseErr.message : 'parse failed' } });
        return vendorError(VENDOR, 'IMAGE_STATUS_FAILED', 'XML parse error — see vendor_api_logs', { requestId, durationMs: Date.now() - startedAt.getTime() });
      }

      const result = extractXmlResult(parsed, 'GetRequestStatusReturn', 'RequestStatusReturn') as Record<string, unknown>;
      const returnStatus = String(result.ReturnStatus ?? '').toLowerCase();
      const imgStatus = String(result.Status ?? '').toLowerCase();

      if (returnStatus === 'success' && imgStatus === 'success') {
        await logRequest({ operation: 'get_request_status', orderId, requestId, startedAt, success: true, httpStatus, requestMeta: { imgRequestId }, responseMeta: { imgStatus } });
        return vendorSuccess({ status: imgStatus, returnStatus: String(result.ReturnStatus ?? '') }, { requestId, durationMs: Date.now() - startedAt.getTime() });
      }

      if (returnStatus === 'success' && imgStatus === 'processing') {
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }

      await logRequest({ operation: 'get_request_status', orderId, requestId, startedAt, success: false, httpStatus, errorCategory: 'TP_IMAGE_STATUS', requestMeta: { imgRequestId }, responseMeta: { returnStatus, imgStatus } });
      return vendorSuccess({ status: imgStatus || returnStatus, returnStatus: String(result.ReturnStatus ?? '') }, { requestId, durationMs: Date.now() - startedAt.getTime() });
    }

    return vendorSuccess({ status: 'processing', returnStatus: 'Success' }, { requestId, durationMs: Date.now() - startedAt.getTime() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    await logRequest({ operation: 'get_request_status', orderId, requestId, startedAt, success: false, errorCategory: 'image_status_failed' });
    return vendorError(VENDOR, 'IMAGE_STATUS_FAILED', msg, { requestId, durationMs: Date.now() - startedAt.getTime() });
  }
}

// ─── GetGeneratedImage (Image Retrieval) ────────────────────────────────────
// Legacy: Titlepoint.php generateImage() line 976-1038 (POST via curl_post)
// FIXES: requestId (lowercase d), uses 'username' not 'userID'

export async function getImage(
  imgRequestId: string,
  orderId?: number
): Promise<VendorResult<TitlePointImageResponse>> {
  const cfg = getConfig();
  const requestId = `tp-${crypto.randomUUID()}`;
  const startedAt = new Date();

  if (!cfg) return mockGetImage(imgRequestId, orderId, requestId, startedAt);

  const MAX_POLLS = 4;
  const POLL_INTERVAL_MS = 1_000;

  try {
    const url = `${cfg.baseUrl}${TP_ENDPOINTS.getGeneratedImage}`;

    for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
      const { status: httpStatus, body: xml } = await tpPostRawForm(url, {
        username: cfg.userID,
        password: cfg.password,
        requestId: imgRequestId,
      });

      let parsed: Record<string, unknown>;
      try {
        parsed = await parseStringPromise(xml, { explicitArray: false, ignoreAttrs: true });
      } catch (parseErr) {
        const snippet = xml.slice(0, 500);
        await logRequest({ operation: 'get_image', orderId, requestId, startedAt, success: false, httpStatus, errorCategory: 'XML_PARSE_ERROR', requestMeta: { imgRequestId, attempt }, responseMeta: { rawSnippet: snippet, parseError: parseErr instanceof Error ? parseErr.message : 'parse failed' } });
        return vendorError(VENDOR, 'IMAGE_FETCH_FAILED', 'XML parse error — see vendor_api_logs for raw response', { requestId, durationMs: Date.now() - startedAt.getTime() });
      }

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

// ─── GetDocumentsByParameters3 (Grant Deed PDF) ─────────────────────────────
// Legacy: Titlepoint.php generateGrantDeed() line 209-238 (POST via curl_post)
// FIXES: completely rewritten to match legacy param shape:
//   - uses 'username' not 'userID'
//   - uses single 'parameters' field with comma-separated values
//   - includes all extra fields legacy sends (company, department, etc.)

export async function getDocumentsByParameters3(
  params: { fips: string; year: string; instrumentDocId: string },
  orderId?: number
): Promise<VendorResult<TitlePointDocumentResponse>> {
  const cfg = getConfig();
  const requestId = `tp-${crypto.randomUUID()}`;
  const startedAt = new Date();

  if (!cfg) {
    const { MOCK_PDF_BASE64 } = await import('./logging');
    await logRequest({ operation: 'get_documents_by_parameters3', orderId, requestId, startedAt, success: true, requestMeta: params });
    return vendorSuccess<TitlePointDocumentResponse>(
      { base64Data: MOCK_PDF_BASE64, returnStatus: 'Success' },
      { requestId, durationMs: Date.now() - startedAt.getTime() }
    );
  }

  try {
    const url = `${cfg.baseUrl}${TP_ENDPOINTS.getDocumentsByParameters3}`;
    const { status: httpStatus, body: xml } = await tpPostRawForm(url, {
      parameters: buildGrantDeedParameters(params.fips, params.year, params.instrumentDocId),
      username: cfg.userID,
      password: cfg.password,
      company: '',
      department: '',
      titleOfficer: '',
      pages: '',
      propertyOnly: 'FALSE',
      maxPageCount: 0,
      maxSizeInKB: 0,
      additionalInfo: '',
      customerRef: '',
      fileType: 'PDF',
    }, 60_000);

    let parsed: Record<string, unknown>;
    try {
      parsed = await parseStringPromise(xml, { explicitArray: false, ignoreAttrs: true });
    } catch (parseErr) {
      const snippet = xml.slice(0, 500);
      await logRequest({ operation: 'get_documents_by_parameters3', orderId, requestId, startedAt, success: false, httpStatus, errorCategory: 'XML_PARSE_ERROR', requestMeta: params, responseMeta: { rawSnippet: snippet, parseError: parseErr instanceof Error ? parseErr.message : 'parse failed' } });
      return vendorError(VENDOR, 'DOCUMENT_FETCH_FAILED', 'XML parse error — see vendor_api_logs for raw response', { requestId, durationMs: Date.now() - startedAt.getTime() });
    }

    const result = extractXmlResult(parsed, 'GetDocumentsByParameters3Return', 'DocumentResponse') as Record<string, unknown>;

    const returnStatus = String(result.ReturnStatus ?? '');
    const docStatus = String(dig(result, 'Documents', 'DocumentResponse', 'DocStatus', 'Msg') ?? '').toLowerCase();

    if (docStatus !== 'ok' && returnStatus !== 'Success') {
      const msg = String(dig(result, 'ReturnErrors', 'ReturnError', 'ErrorDescription') ?? `GetDocumentsByParameters3 returned ${returnStatus}`);
      await logRequest({ operation: 'get_documents_by_parameters3', orderId, requestId, startedAt, success: false, httpStatus, errorCategory: 'TP_DOC_ERROR', requestMeta: params, responseMeta: { returnStatus } });
      return vendorError(VENDOR, 'DOCUMENT_FETCH_FAILED', msg, { requestId, durationMs: Date.now() - startedAt.getTime() });
    }

    // Legacy path: Documents > DocumentResponse > Document > Body > Body
    const base64Data = String(
      dig(result, 'Documents', 'DocumentResponse', 'Document', 'Body', 'Body') ??
      dig(result, 'Documents', 'DocumentResponse', 'Document', 'Body', 'Data') ??
      dig(result, 'Document', 'Body', 'Body') ??
      ''
    );

    if (!base64Data) {
      await logRequest({ operation: 'get_documents_by_parameters3', orderId, requestId, startedAt, success: false, httpStatus, errorCategory: 'TP_NO_DOCUMENT', requestMeta: params });
      return vendorError(VENDOR, 'DOCUMENT_FETCH_FAILED', 'No document data in response', { requestId, durationMs: Date.now() - startedAt.getTime() });
    }

    await logRequest({ operation: 'get_documents_by_parameters3', orderId, requestId, startedAt, success: true, httpStatus, requestMeta: params, responseMeta: { size: base64Data.length } });
    return vendorSuccess<TitlePointDocumentResponse>(
      { base64Data, returnStatus },
      { requestId, durationMs: Date.now() - startedAt.getTime() }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    await logRequest({ operation: 'get_documents_by_parameters3', orderId, requestId, startedAt, success: false, errorCategory: 'doc_fetch_failed', requestMeta: params });
    return vendorError(VENDOR, 'DOCUMENT_FETCH_FAILED', msg, { requestId, durationMs: Date.now() - startedAt.getTime() });
  }
}
