import { db } from '@/lib/db/client';
import { titlePointData, orderProperties, jobs } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { getOrderByIdSimple } from '@/lib/domain/orders/service';
import { uploadDocument } from '@/lib/domain/documents/service';
import { createService, getRequestSummaries, getResult } from '@/lib/integrations/titlepoint/client';
import { requestImage, getRequestStatus, getImage } from '@/lib/integrations/titlepoint/client-image';
import { resolveCaliforniaFips } from '@/lib/integrations/titlepoint/fips';
import type { TitlePointSearchType } from '@/lib/integrations/titlepoint/types';

// ─── Search-type to document category mapping ───────────────────────────────

const SEARCH_TYPE_DOC_CATEGORY: Record<TitlePointSearchType, string> = {
  geo_address: 'general',
  legal_vesting: 'legal_vesting',
  grant_deed: 'grant_deed',
  tax: 'tax',
};

// ─── Initiate Search ────────────────────────────────────────────────────────

export async function initiateSearch(
  orderId: number,
  searchType: TitlePointSearchType,
  userId: string
): Promise<{ success: boolean; titlePointDataId?: number; error?: string }> {
  const order = await getOrderByIdSimple(orderId);
  if (!order) return { success: false, error: 'Order not found' };

  const [property] = await db
    .select()
    .from(orderProperties)
    .where(eq(orderProperties.orderId, orderId))
    .limit(1);

  const address = property?.address ?? '';
  const city = property?.city ?? '';
  const state = property?.state ?? 'CA';
  const county = property?.county ?? '';
  const apn = property?.apn ?? undefined;
  const fips = property?.fips ?? resolveCaliforniaFips(county) ?? undefined;

  const result = await createService(
    { address, city, state, county, fips, apn, searchType },
    orderId
  );

  if (!result.success) {
    const [record] = await db
      .insert(titlePointData)
      .values({
        orderId,
        fileNumber: order.fileNumber,
        searchType,
        status: 'failed',
        message: result.error?.message ?? 'CreateService failed',
        metadata: { userId } as Record<string, unknown>,
      })
      .returning({ id: titlePointData.id });

    return { success: false, titlePointDataId: record!.id, error: result.error?.message };
  }

  const tpData = result.data!;

  const [record] = await db
    .insert(titlePointData)
    .values({
      orderId,
      fileNumber: order.fileNumber,
      requestId: tpData.requestId,
      searchType,
      status: 'pending',
      metadata: { userId, tpOrderId: tpData.orderId } as Record<string, unknown>,
    })
    .returning({ id: titlePointData.id });

  return { success: true, titlePointDataId: record!.id };
}

// ─── Poll Search ────────────────────────────────────────────────────────────

export async function pollSearch(
  titlePointDataId: number
): Promise<{ status: 'pending' | 'success' | 'failed'; error?: string }> {
  const [record] = await db
    .select()
    .from(titlePointData)
    .where(eq(titlePointData.id, titlePointDataId))
    .limit(1);

  if (!record) return { status: 'failed', error: 'TitlePoint record not found' };
  if (!record.requestId) return { status: 'failed', error: 'No requestId to poll' };

  const result = await getRequestSummaries(record.requestId, record.orderId ?? undefined);

  if (!result.success) {
    await db
      .update(titlePointData)
      .set({
        status: 'failed',
        message: result.error?.message ?? 'Poll failed',
        updatedAt: new Date(),
      })
      .where(eq(titlePointData.id, titlePointDataId));

    return { status: 'failed', error: result.error?.message };
  }

  const summary = result.data!;

  if (summary.status === 'pending') {
    await db
      .update(titlePointData)
      .set({ message: summary.message ?? 'Still processing...', updatedAt: new Date() })
      .where(eq(titlePointData.id, titlePointDataId));

    return { status: 'pending' };
  }

  if (summary.status === 'failed') {
    await db
      .update(titlePointData)
      .set({
        status: 'failed',
        message: summary.message ?? 'TitlePoint search failed',
        updatedAt: new Date(),
      })
      .where(eq(titlePointData.id, titlePointDataId));

    return { status: 'failed', error: summary.message };
  }

  // success — store first serviceId + resultId (resultId is needed for GetResultByID3)
  const serviceId = summary.serviceIds[0] ?? null;
  const resultId = summary.resultIds[0] ?? null;
  await db
    .update(titlePointData)
    .set({
      status: 'ready',
      serviceId,
      message: `Completed with ${summary.serviceIds.length} service(s)`,
      metadata: { ...((await db.select().from(titlePointData).where(eq(titlePointData.id, titlePointDataId)).limit(1))[0]?.metadata as Record<string, unknown> ?? {}), resultId } as Record<string, unknown>,
      updatedAt: new Date(),
    })
    .where(eq(titlePointData.id, titlePointDataId));

  return { status: 'success' };
}

// ─── Fetch Result ───────────────────────────────────────────────────────────

export async function fetchResult(
  titlePointDataId: number
): Promise<{ success: boolean; error?: string }> {
  const [record] = await db
    .select()
    .from(titlePointData)
    .where(eq(titlePointData.id, titlePointDataId))
    .limit(1);

  if (!record) return { success: false, error: 'TitlePoint record not found' };
  const meta = (record.metadata as Record<string, unknown>) ?? {};
  const resultId = (meta.resultId as string) ?? record.serviceId;
  if (!resultId) return { success: false, error: 'No resultId available' };

  const result = await getResult(resultId, record.orderId ?? undefined);

  if (!result.success) {
    await db
      .update(titlePointData)
      .set({
        status: 'failed',
        message: result.error?.message ?? 'Result fetch failed',
        updatedAt: new Date(),
      })
      .where(eq(titlePointData.id, titlePointDataId));

    return { success: false, error: result.error?.message };
  }

  const existing = (record.metadata as Record<string, unknown>) ?? {};
  await db
    .update(titlePointData)
    .set({
      status: 'result_ready',
      metadata: { ...existing, resultData: result.data!.data } as Record<string, unknown>,
      fips: (result.data!.data as Record<string, unknown>).fips as string ?? record.fips,
      updatedAt: new Date(),
    })
    .where(eq(titlePointData.id, titlePointDataId));

  return { success: true };
}

// ─── Fetch Image ────────────────────────────────────────────────────────────

export async function fetchImage(
  titlePointDataId: number
): Promise<{ success: boolean; documentId?: number; error?: string }> {
  const [record] = await db
    .select()
    .from(titlePointData)
    .where(eq(titlePointData.id, titlePointDataId))
    .limit(1);

  if (!record) return { success: false, error: 'TitlePoint record not found' };
  if (!record.serviceId) return { success: false, error: 'No serviceId available' };
  if (!record.orderId) return { success: false, error: 'No orderId — cannot upload document yet' };

  const meta = (record.metadata as Record<string, unknown>) ?? {};
  const userId = (meta.userId as string) ?? 'system';
  const oid = record.orderId;

  // Step 1: CreateRequest3 — request image generation
  const imgReqResult = await requestImage(record.serviceId, oid);
  if (!imgReqResult.success) {
    return { success: false, error: imgReqResult.error?.message ?? 'Image request failed' };
  }

  // Step 2: GetRequestStatus — poll until ready (legacy step)
  const statusResult = await getRequestStatus(imgReqResult.data!.requestId, oid);
  if (!statusResult.success) {
    return { success: false, error: statusResult.error?.message ?? 'Image status check failed' };
  }

  // Step 3: GetGeneratedImage — download the PDF
  const imgResult = await getImage(imgReqResult.data!.requestId, oid);
  if (!imgResult.success) {
    return { success: false, error: imgResult.error?.message ?? 'Image fetch failed' };
  }

  // Step 4: Decode base64 → upload to S3 → create document
  const pdfBuffer = Buffer.from(imgResult.data!.base64Data, 'base64');
  const searchType = (record.searchType ?? 'general') as TitlePointSearchType;
  const docCategory = SEARCH_TYPE_DOC_CATEGORY[searchType] ?? 'general';
  const filename = `tp_${record.fileNumber ?? 'pre'}_${searchType}_${Date.now()}.pdf`;

  try {
    const uploadResult = await uploadDocument({
      orderId: oid,
      file: pdfBuffer,
      filename,
      contentType: 'application/pdf',
      category: docCategory as 'general' | 'legal_vesting' | 'grant_deed' | 'tax',
      description: `TitlePoint ${searchType} - ${record.fileNumber ?? 'pre-order'}`,
      userId,
    });

    await db
      .update(titlePointData)
      .set({
        status: 'completed',
        message: 'Document retrieved and uploaded',
        metadata: { ...meta, documentId: uploadResult.documentId } as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .where(eq(titlePointData.id, titlePointDataId));

    return { success: true, documentId: uploadResult.documentId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Document upload failed';
    await db
      .update(titlePointData)
      .set({
        status: 'failed',
        message: msg,
        updatedAt: new Date(),
      })
      .where(eq(titlePointData.id, titlePointDataId));

    return { success: false, error: msg };
  }
}

// ─── Retry Failed Searches ──────────────────────────────────────────────────

export async function retryFailedSearches(
  orderId: number,
  userId: string
): Promise<{ retried: number; failed: number; results: Array<{ searchType: string; status: string; error?: string }> }> {
  const failedRows = await db
    .select()
    .from(titlePointData)
    .where(
      and(
        eq(titlePointData.orderId, orderId),
        eq(titlePointData.status, 'failed'),
      )
    );

  if (failedRows.length === 0) {
    return { retried: 0, failed: 0, results: [] };
  }

  const results: Array<{ searchType: string; status: string; error?: string }> = [];
  let retried = 0;
  let failed = 0;

  for (const row of failedRows) {
    const searchType = (row.searchType ?? 'geo_address') as TitlePointSearchType;

    const initResult = await initiateSearch(orderId, searchType, userId);

    if (initResult.success && initResult.titlePointDataId) {
      await db.insert(jobs).values({
        jobType: 'titlepoint.poll',
        payload: { titlePointDataId: initResult.titlePointDataId } as Record<string, unknown>,
        status: 'queued',
        nextRetryAt: new Date(Date.now() + 30_000),
      });

      await db
        .update(titlePointData)
        .set({ status: 'superseded', message: `Retried — new record #${initResult.titlePointDataId}`, updatedAt: new Date() })
        .where(eq(titlePointData.id, row.id));

      retried++;
      results.push({ searchType, status: 'retried' });
    } else {
      failed++;
      results.push({ searchType, status: 'failed', error: initResult.error });
    }
  }

  return { retried, failed, results };
}

// ─── Query Helpers ──────────────────────────────────────────────────────────

export async function getTitlePointRecord(id: number) {
  const [record] = await db
    .select()
    .from(titlePointData)
    .where(eq(titlePointData.id, id))
    .limit(1);
  return record ?? null;
}
