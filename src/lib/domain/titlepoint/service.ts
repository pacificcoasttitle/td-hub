import { db } from '@/lib/db/client';
import { titlePointData, orderProperties } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { getOrderByIdSimple } from '@/lib/domain/orders/service';
import { uploadDocument } from '@/lib/domain/documents/service';
import {
  createService,
  getRequestSummaries,
  getResult,
  requestImage,
  getImage,
} from '@/lib/integrations/titlepoint/client';
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
  const fips = property?.fips ?? undefined;

  const result = await createService(
    { address, city, state, county, fips, searchType },
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

  const result = await getRequestSummaries(record.requestId, record.orderId);

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

  const result = await getResult(resultId, record.orderId);

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

  const meta = (record.metadata as Record<string, unknown>) ?? {};
  const userId = (meta.userId as string) ?? 'system';

  // Step 1: Request image
  const imgReqResult = await requestImage(record.serviceId, record.orderId);
  if (!imgReqResult.success) {
    return { success: false, error: imgReqResult.error?.message ?? 'Image request failed' };
  }

  // Step 2: Get image data
  const imgResult = await getImage(imgReqResult.data!.requestId, record.orderId);
  if (!imgResult.success) {
    return { success: false, error: imgResult.error?.message ?? 'Image fetch failed' };
  }

  // Step 3: Decode base64 → upload to S3 → create document
  const pdfBuffer = Buffer.from(imgResult.data!.base64Data, 'base64');
  const searchType = (record.searchType ?? 'general') as TitlePointSearchType;
  const docCategory = SEARCH_TYPE_DOC_CATEGORY[searchType] ?? 'general';
  const filename = `tp_${record.fileNumber}_${searchType}_${Date.now()}.pdf`;

  try {
    const uploadResult = await uploadDocument({
      orderId: record.orderId,
      file: pdfBuffer,
      filename,
      contentType: 'application/pdf',
      category: docCategory as 'general' | 'legal_vesting' | 'grant_deed' | 'tax',
      description: `TitlePoint ${searchType} - ${record.fileNumber}`,
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

// ─── Query Helpers ──────────────────────────────────────────────────────────

export async function getTitlePointRecord(id: number) {
  const [record] = await db
    .select()
    .from(titlePointData)
    .where(eq(titlePointData.id, id))
    .limit(1);
  return record ?? null;
}
