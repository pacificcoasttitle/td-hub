import { parseStringPromise } from 'xml2js';
import { vendorSuccess, vendorError } from '@/lib/integrations/types';
import type { VendorResult } from '@/lib/integrations/types';
import type { TitlePointImageResponse, TitlePointDocumentResponse } from './types';
import { VENDOR, logRequest } from './logging';
import { rawPost, buildRawBody, dig, extractXmlResult } from './http';
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

// ─── GetDocumentsByParameters3 (Grant Deed PDF) ─────────────────────────────

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
    const url = `${cfg.baseUrl}${TP_ENDPOINTS.getDocumentsByParameters3}?`;
    const { status: httpStatus, body: xml } = await rawPost(url, buildRawBody({
      userID: cfg.userID,
      password: cfg.password,
      fIPSCode: params.fips,
      searchType: 'REC',
      searchSubType: 'ALL',
      year: params.year,
      instrumentNumber: params.instrumentDocId,
      book: '',
      page: '',
      fileType: 'PDF',
    }), 60_000);

    const parsed = await parseStringPromise(xml, { explicitArray: false, ignoreAttrs: true });
    const result = extractXmlResult(parsed, 'GetDocumentsByParameters3Return', 'DocumentResponse') as Record<string, unknown>;

    const returnStatus = String(result.ReturnStatus ?? '');
    if (returnStatus !== 'Success') {
      const msg = String(dig(result, 'ReturnErrors', 'ReturnError', 'ErrorDescription') ?? `GetDocumentsByParameters3 returned ${returnStatus}`);
      await logRequest({ operation: 'get_documents_by_parameters3', orderId, requestId, startedAt, success: false, httpStatus, errorCategory: 'TP_DOC_ERROR', requestMeta: params, responseMeta: { returnStatus } });
      return vendorError(VENDOR, 'DOCUMENT_FETCH_FAILED', msg, { requestId, durationMs: Date.now() - startedAt.getTime() });
    }

    const docs = dig(result, 'Documents', 'DocumentResponse', 'Document') ?? dig(result, 'Document');
    const docNode = (Array.isArray(docs) ? docs[0] : docs) as Record<string, unknown> | undefined;
    const base64Data = String(
      dig(docNode, 'Body', 'Body') ??
      dig(docNode, 'Body', 'Data') ??
      dig(result, 'Body', 'Body') ??
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
