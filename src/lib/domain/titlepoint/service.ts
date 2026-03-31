import { db } from '@/lib/db/client';
import { titlePointData, orderProperties, jobs } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { getOrderByIdSimple } from '@/lib/domain/orders/service';
import { uploadDocument, attachToSoftPro } from '@/lib/domain/documents/service';
import {
  createService,
  getRequestSummaries,
  getResultById3Geo,
  getResultById3Tax,
  getResultByIdLv,
} from '@/lib/integrations/titlepoint/client';
import { requestImage, getRequestStatus, getImage } from '@/lib/integrations/titlepoint/client-image';
import { resolveCaliforniaFips } from '@/lib/integrations/titlepoint/fips';
import { fetchGrantDeed } from '@/lib/domain/titlepoint/grant-deed';
import { maybeEnqueueConfirmation } from '@/lib/domain/titlepoint/completion-checker';
import type { TitlePointSearchType } from '@/lib/integrations/titlepoint/types';

// ─── Search-type to document category mapping ───────────────────────────────

const SEARCH_TYPE_DOC_CATEGORY: Record<TitlePointSearchType, string> = {
  geo_address: 'general',
  legal_vesting: 'legal_vesting',
  grant_deed: 'grant_deed',
  tax: 'tax',
};

const POLL_MAX_ATTEMPTS = 3;
const POLL_INTERVAL_MS = 5_000;
const PIPELINE_TIMEOUT_MS = 60_000;

// ─── Initiate Search ────────────────────────────────────────────────────────
// After successful createService, executes the full pipeline INLINE:
//   poll → result → image → upload → softpro
// Falls back to leaving a job row for a future cron if pipeline times out.

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
      status: 'processing',
      metadata: { userId, tpOrderId: tpData.orderId } as Record<string, unknown>,
    })
    .returning({ id: titlePointData.id });

  const tpDataId = record!.id;

  // Insert job row for observability — will be marked completed after inline execution
  const [jobRow] = await db
    .insert(jobs)
    .values({
      jobType: 'titlepoint.poll',
      orderId,
      payload: { titlePointDataId: tpDataId } as Record<string, unknown>,
      status: 'running',
    })
    .returning({ id: jobs.id });

  // Execute full pipeline inline
  const pipelineResult = await executePipeline(tpDataId);

  // Mark job based on outcome
  if (pipelineResult.success) {
    await db.update(jobs).set({
      status: 'completed',
      endedAt: new Date(),
      attempts: 1,
    }).where(eq(jobs.id, jobRow!.id));
  } else if (pipelineResult.timedOut) {
    // Timed out — leave job as queued for future cron pickup
    await db.update(jobs).set({
      status: 'queued',
      nextRetryAt: new Date(Date.now() + 30_000),
    }).where(eq(jobs.id, jobRow!.id));
  } else {
    await db.update(jobs).set({
      status: 'failed',
      error: pipelineResult.error,
      endedAt: new Date(),
      attempts: 1,
    }).where(eq(jobs.id, jobRow!.id));
  }

  return {
    success: pipelineResult.success,
    titlePointDataId: tpDataId,
    error: pipelineResult.error,
  };
}

// ─── Execute Pipeline (inline) ──────────────────────────────────────────────
// Runs the full TitlePoint lifecycle after CreateService:
//   1. Poll GetRequestSummaries (up to 3 attempts, 5s apart)
//   2. Fetch result via GetResultByID3 (or GetResultByID for LV)
//   3. Generate image (CreateRequest3 → GetRequestStatus → GetGeneratedImage)
//   4. Upload PDF to S3, create documents row
//   5. Attach to SoftPro (best effort)
//   6. Update title_point_data to 'completed'
// If the whole thing takes >60s, returns { timedOut: true } for cron fallback.

async function executePipeline(
  titlePointDataId: number,
): Promise<{ success: boolean; timedOut?: boolean; error?: string }> {
  console.error('[TP-PIPELINE] Starting executePipeline for titlePointDataId:', titlePointDataId);

  try {
    const deadline = Date.now() + PIPELINE_TIMEOUT_MS;

    // ── Step 1: Poll for completion ──
    let pollResult: Awaited<ReturnType<typeof pollSearch>> = { status: 'pending' };

    for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
      if (Date.now() > deadline) {
        return { success: false, timedOut: true, error: 'Pipeline timeout during polling' };
      }

      console.error('[TP-PIPELINE] Step 1 pollSearch starting...');
      pollResult = await pollSearch(titlePointDataId);

      if (pollResult.status === 'success') break;
      if (pollResult.status === 'failed') {
        return { success: false, error: pollResult.error ?? 'Poll returned failed' };
      }

      if (attempt < POLL_MAX_ATTEMPTS - 1) {
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
      }
    }

    if (pollResult.status === 'pending') {
      return { success: false, timedOut: true, error: 'Still processing after max poll attempts' };
    }

    if (pollResult.status !== 'success') {
      return { success: false, error: pollResult.error };
    }

    // ── Step 2: Fetch result data ──
    if (Date.now() > deadline) {
      return { success: false, timedOut: true, error: 'Pipeline timeout before result fetch' };
    }

    console.error('[TP-PIPELINE] Step 2 fetchResult starting...');
    const resultOutcome = await fetchResult(titlePointDataId);
    if (!resultOutcome.success) {
      return { success: false, error: resultOutcome.error };
    }

    // ── Step 3: Generate image + upload + SoftPro ──
    if (Date.now() > deadline) {
      return { success: false, timedOut: true, error: 'Pipeline timeout before image generation' };
    }

    console.error('[TP-PIPELINE] Step 3 fetchImage starting...');
    const imageOutcome = await fetchImage(titlePointDataId);
    if (!imageOutcome.success) {
      return { success: false, error: imageOutcome.error };
    }

    // ── Step 4: Post-completion triggers (best-effort, don't fail pipeline) ──
    const [record] = await db
      .select()
      .from(titlePointData)
      .where(eq(titlePointData.id, titlePointDataId))
      .limit(1);

    if (record) {
      if (record.searchType === 'legal_vesting') {
        try { await fetchGrantDeed(titlePointDataId); } catch { /* best effort */ }
      }

      if (record.orderId) {
        try { await maybeEnqueueConfirmation(record.orderId); } catch { /* best effort */ }
      }
    }

    return { success: true };
  } catch (error) {
    console.error('[TP-PIPELINE] FAILED:', error);
    throw error;
  }
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

  const result = record.searchType === 'legal_vesting'
    ? await getResultByIdLv(resultId, record.orderId ?? undefined)
    : record.searchType === 'geo_address'
      ? await getResultById3Geo(resultId, record.fileNumber ?? null, record.orderId ?? undefined)
      : await getResultById3Tax(resultId, record.orderId ?? undefined);

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
      fips: ((result.data!.data as Record<string, unknown>).Fips as string)
        ?? ((result.data!.data as Record<string, unknown>).fips as string)
        ?? record.fips,
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

    try { await attachToSoftPro(uploadResult.documentId, 'Title Docs'); } catch { /* best effort */ }

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
// Same pattern as initiateSearch: re-creates the search, then executes the
// full pipeline inline instead of just enqueuing a job.

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

    // Mark old row as superseded before re-initiating
    await db
      .update(titlePointData)
      .set({ status: 'superseded', message: 'Retrying...', updatedAt: new Date() })
      .where(eq(titlePointData.id, row.id));

    // initiateSearch now runs the full pipeline inline
    const initResult = await initiateSearch(orderId, searchType, userId);

    if (initResult.success) {
      retried++;
      results.push({ searchType, status: 'completed' });
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
