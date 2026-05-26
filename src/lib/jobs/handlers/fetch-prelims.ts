import { db } from '@/lib/db/client';
import { orders, documents, documentAudit, prelimAnalyses } from '@/lib/db/schema';
import { sql, and, eq, or, isNull, asc, desc, lt } from 'drizzle-orm';
import { getAttachedDocuments } from '@/lib/integrations/softpro';
import { uploadFile as s3Upload } from '@/lib/integrations/s3/client';
import { analyzePrelim } from '@/lib/tessa';

export interface FetchPrelimsResult {
  total: number;
  attempted: number;
  fetched: number;
  documentsStored: number;
  skipped: number;
  retried: number;
  timedOut: boolean;
  errors: Array<{ fileNumber: string; error: string }>;
}

const TIME_BUDGET_MS = 240_000;
// Cap retries at 5: prevents runaway retries on permanent failures
// (e.g., image-based PDFs that can't be text-extracted).
// See: ops report incident 2026-05-26 (Orders 324, 3259)
const MAX_TESSA_ATTEMPTS = 5;

/**
 * Finds orders without prelim documents and attempts to fetch them
 * from SoftPro's GetAttachedDocuments endpoint. Downloaded PDFs
 * are stored in S3 and recorded in the documents table.
 */
export async function handleFetchPrelims(): Promise<FetchPrelimsResult> {
  // Prioritize orders never attempted (lastPrelimFetchAt IS NULL → asc nulls first),
  // then those whose last attempt is older than 6 hours.
  // Orders attempted within the last 6 hours are skipped to prevent the cron
  // from re-polling the same unproductive files every 30 minutes.
  const ordersWithoutPrelims = await db
    .select({ id: orders.id, fileNumber: orders.fileNumber })
    .from(orders)
    .where(and(
      sql`${orders.operationalStatus} in ('open', 'in_process', 'completed')`,
      sql`${orders.id} NOT IN (SELECT order_id FROM documents WHERE category = 'prelim' AND status = 'active')`,
      or(
        isNull(orders.lastPrelimFetchAt),
        sql`${orders.lastPrelimFetchAt} < NOW() - INTERVAL '6 hours'`,
      ),
    ))
    .orderBy(asc(orders.lastPrelimFetchAt))
    .limit(50);

  const startTime = Date.now();
  let attempted = 0;
  let fetched = 0;
  let documentsStored = 0;
  let skipped = 0;
  let timedOut = false;
  const errors: Array<{ fileNumber: string; error: string }> = [];

  for (const order of ordersWithoutPrelims) {
    if (Date.now() - startTime > TIME_BUDGET_MS) {
      console.warn(`[fetch-prelims] Time budget exhausted after ${attempted} of ${ordersWithoutPrelims.length} orders — exiting cleanly`);
      timedOut = true;
      break;
    }

    attempted++;
    try {
      const stored = await fetchPrelimsForOrder(order.id, order.fileNumber);
      if (stored > 0) {
        fetched++;
        documentsStored += stored;
      } else {
        skipped++;
      }
    } catch (err) {
      errors.push({ fileNumber: order.fileNumber, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  }

  // ── Phase 2: Retry failed analyses ──
  // Only retries orders whose latest analysis is 'failed' (e.g. DOMMatrix era).
  // Historical prelims without any analysis row are on-demand only.
  // Skip Phase 2 entirely if Phase 1 already exhausted the time budget.
  let retried = 0;
  if (timedOut) {
    return { total: ordersWithoutPrelims.length, attempted, fetched, documentsStored, skipped, retried, timedOut, errors };
  }
  try {
    const failedRows = await db
      .select({
        id: prelimAnalyses.id,
        orderId: prelimAnalyses.orderId,
        documentId: prelimAnalyses.documentId,
        fileNumber: prelimAnalyses.fileNumber,
        attemptCount: prelimAnalyses.attemptCount,
        storageKey: documents.storageKey,
      })
      .from(prelimAnalyses)
      .innerJoin(documents, eq(documents.id, prelimAnalyses.documentId))
      .where(and(
        eq(prelimAnalyses.status, 'failed'),
        lt(prelimAnalyses.attemptCount, MAX_TESSA_ATTEMPTS),
        sql`NOT EXISTS (
          SELECT 1 FROM prelim_analyses pa2
          WHERE pa2.document_id = ${prelimAnalyses.documentId}
            AND pa2.status != 'failed'
        )`,
        sql`NOT EXISTS (
          SELECT 1 FROM prelim_analyses newer
          WHERE newer.document_id = ${prelimAnalyses.documentId}
            AND newer.status = 'failed'
            AND newer.updated_at > ${prelimAnalyses.updatedAt}
        )`,
      ))
      .orderBy(desc(prelimAnalyses.updatedAt))
      .limit(5);

    for (const row of failedRows) {
      const nextAttempt = row.attemptCount + 1;
      try {
        console.log(`[TESSA] Retrying failed analysis for order ${row.orderId}`);
        const result = await analyzePrelim({
          orderId: row.orderId!,
          documentId: row.documentId!,
          fileNumber: row.fileNumber!,
          storageKey: row.storageKey,
          triggeredBy: 'cron',
          attemptCount: nextAttempt,
        });
        if (result.status === 'failed' && nextAttempt >= MAX_TESSA_ATTEMPTS && result.analysisId > 0) {
          await markTessaRetryCapReached(result.analysisId, result.error ?? 'Analysis failed');
        }
        retried++;
      } catch (err) {
        if (nextAttempt >= MAX_TESSA_ATTEMPTS) {
          await markTessaRetryCapReached(row.id, err instanceof Error ? err.message : 'Unknown retry failure');
        }
        console.error('[TESSA] Retry failed:', {
          orderId: row.orderId,
          message: err instanceof Error ? err.message : err,
        });
      }
    }
  } catch (err) {
    console.error('[TESSA] Phase 2 query failed:', err instanceof Error ? err.message : err);
  }

  return { total: ordersWithoutPrelims.length, attempted, fetched, documentsStored, skipped, retried, timedOut, errors };
}

async function markTessaRetryCapReached(analysisId: number, error: string) {
  await db.update(prelimAnalyses)
    .set({
      status: 'failed',
      attemptCount: MAX_TESSA_ATTEMPTS,
      errorType: 'max_attempts_reached',
      errorMessage: `Failed after ${MAX_TESSA_ATTEMPTS} attempts: ${error}`,
      updatedAt: new Date(),
    })
    .where(eq(prelimAnalyses.id, analysisId));
}

/**
 * Fetch and store prelim documents for a single order.
 * Returns the number of documents successfully stored.
 */
export async function fetchPrelimsForOrder(
  orderId: number,
  fileNumber: string,
): Promise<number> {
  const [existing] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(documents)
    .where(and(
      eq(documents.orderId, orderId),
      eq(documents.category, 'prelim'),
      eq(documents.status, 'active'),
    ));

  if (existing && existing.count > 0) {
    console.log(`[fetch-prelims] Order ${fileNumber} already has ${existing.count} active prelim doc(s), skipping SoftPro call`);
    return 0;
  }

  const result = await getAttachedDocuments(fileNumber);

  // Stamp the attempt regardless of outcome so the cron's 6-hour
  // re-check window applies to both empty and successful responses.
  await db.update(orders)
    .set({ lastPrelimFetchAt: sql`NOW()` })
    .where(eq(orders.id, orderId));

  if (!result.success || !result.data) return 0;

  const urls = extractUrls(result.data);
  if (urls.length === 0) return 0;

  let stored = 0;
  for (const url of urls) {
    try {
      const { buffer, filename } = await downloadFromUrl(url);
      const storageKey = `prelim-upload-doc/${fileNumber}/${Date.now()}_${filename}`;

      const upload = await s3Upload({ key: storageKey, buffer, contentType: 'application/pdf' });
      if (!upload.success) continue;

      const [doc] = await db.insert(documents).values({
        orderId,
        category: 'prelim',
        filename,
        originalFilename: filename,
        storageProvider: 's3',
        storageKey,
        contentType: 'application/pdf',
        sizeBytes: buffer.length,
        status: 'active',
        description: `Prelim fetched from SoftPro for ${fileNumber}`,
        createdBy: 'job:fetch_prelims',
      }).returning({ id: documents.id });

      await db.insert(documentAudit).values({
        documentId: doc!.id,
        action: 'uploaded',
        byUserId: 'job:fetch_prelims',
        meta: { source: 'softpro_fetch', sourceUrl: url, storageKey, sizeBytes: buffer.length } as Record<string, unknown>,
      });

      try {
        await analyzePrelim({
          orderId,
          documentId: doc!.id,
          fileNumber,
          storageKey,
          triggeredBy: 'cron',
        });
      } catch (err) {
        console.error('[TESSA] Cron-triggered analysis failed:', {
          orderId,
          documentId: doc!.id,
          fileNumber,
          message: err instanceof Error ? err.message : err,
          stack: err instanceof Error ? err.stack : undefined,
        });
      }

      stored++;
    } catch { /* per-URL failure doesn't stop the batch */ }
  }

  return stored;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function extractUrls(data: unknown): string[] {
  if (Array.isArray(data)) {
    return data.filter((item): item is string => typeof item === 'string' && item.startsWith('http'));
  }
  return [];
}

async function downloadFromUrl(url: string): Promise<{ buffer: Buffer; filename: string }> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const filename = new URL(url).pathname.split('/').pop() ?? `prelim_${Date.now()}.pdf`;
  return { buffer, filename };
}
