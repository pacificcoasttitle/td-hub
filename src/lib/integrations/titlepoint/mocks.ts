import { vendorSuccess } from '@/lib/integrations/types';
import type { VendorResult } from '@/lib/integrations/types';
import type {
  TitlePointCreateInput, TitlePointCreateResponse,
  TitlePointSummaryResponse, TitlePointResultResponse,
  TitlePointImageResponse,
} from './types';
import { logRequest, MOCK_PDF_BASE64, pollCounts, delay } from './logging';

export async function mockCreateService(
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

export async function mockGetRequestSummaries(
  tpRequestId: string, orderId: number | undefined, requestId: string, startedAt: Date,
): Promise<VendorResult<TitlePointSummaryResponse>> {
  await delay(30);
  const count = (pollCounts.get(tpRequestId) ?? 0) + 1;
  pollCounts.set(tpRequestId, count);
  const isPending = count === 1;
  const response: TitlePointSummaryResponse = isPending
    ? { status: 'pending', serviceIds: [], resultIds: [], message: 'Processing...' }
    : { status: 'success', serviceIds: [`SVC-${tpRequestId}-001`], resultIds: [`RES-${tpRequestId}-001`] };
  if (!isPending) pollCounts.delete(tpRequestId);
  await logRequest({ operation: 'get_request_summaries', orderId, requestId, startedAt, success: true, httpStatus: 200, requestMeta: { tpRequestId, pollCount: count, mock: true }, responseMeta: { status: response.status, serviceCount: response.serviceIds.length } });
  return vendorSuccess(response, { requestId, durationMs: Date.now() - startedAt.getTime() });
}

export async function mockGetResult(
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

export async function mockRequestImage(
  serviceId: string, orderId: number | undefined, requestId: string, startedAt: Date,
): Promise<VendorResult<{ requestId: string; orderId: string }>> {
  await delay(20);
  const imgRequestId = `IMG-${Date.now()}`;
  const imgOrderId = `IORD-${Date.now()}`;
  await logRequest({ operation: 'request_image', orderId, requestId, startedAt, success: true, httpStatus: 200, requestMeta: { serviceId, mock: true }, responseMeta: { imgRequestId } });
  return vendorSuccess({ requestId: imgRequestId, orderId: imgOrderId }, { requestId, durationMs: Date.now() - startedAt.getTime() });
}

export async function mockGetImage(
  imgRequestId: string, orderId: number | undefined, requestId: string, startedAt: Date,
): Promise<VendorResult<TitlePointImageResponse>> {
  await delay(30);
  const response: TitlePointImageResponse = { base64Data: MOCK_PDF_BASE64, status: 'Success', returnStatus: 'OK' };
  await logRequest({ operation: 'get_image', orderId, requestId, startedAt, success: true, httpStatus: 200, requestMeta: { imgRequestId, mock: true } });
  return vendorSuccess(response, { requestId, durationMs: Date.now() - startedAt.getTime() });
}
