import { db } from '@/lib/db/client';
import { orders, documents, prelimAnalyses } from '@/lib/db/schema';
import { sql, and, eq, or, isNull, asc } from 'drizzle-orm';
import { getAttachedDocuments } from '@/lib/integrations/softpro';
import { describeAttachedDocuments } from '@/lib/integrations/softpro/client';
import { analyzePrelim } from '@/lib/tessa';
import { budgetMsFor } from '@/lib/jobs/time-budget';
import {
  isTessaAutoAnalysisEnabled,
  logCronCycleAutoAnalysisPaused,
} from '@/lib/tessa/analysis-config';
import { ingestPrelimFromSoftPro } from '@/lib/domain/documents/ingest-prelim-from-softpro';

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

type TessaCandidateRow = {
  analysis_id: number | null;
  order_id: number;
  document_id: number;
  file_number: string;
  attempt_count: number;
  storage_key: string;
};

// Sized from the measured p99 of ONE unit (an order's fetch + inline TESSA
// analysis, ~90s), not a flat number — see src/lib/jobs/time-budget.ts.
const TIME_BUDGET_MS = budgetMsFor('softpro.fetch_prelims');
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
  if (!isTessaAutoAnalysisEnabled()) {
    logCronCycleAutoAnalysisPaused();
    return { total: ordersWithoutPrelims.length, attempted, fetched, documentsStored, skipped, retried, timedOut, errors };
  }
  try {
    const candidateRows = await db.execute(sql`
      with latest_analysis as (
        select distinct on (document_id)
          id,
          document_id,
          file_number,
          status,
          attempt_count,
          updated_at
        from prelim_analyses
        where document_id is not null
        order by document_id, updated_at desc nulls last, id desc
      )
      select
        la.id as analysis_id,
        d.order_id,
        d.id as document_id,
        coalesce(la.file_number, o.file_number) as file_number,
        coalesce(la.attempt_count, 0)::int as attempt_count,
        d.storage_key
      from documents d
      inner join orders o on o.id = d.order_id
      left join latest_analysis la on la.document_id = d.id
      where d.category = 'prelim'
        and d.status = 'active'
        and (
          la.id is null
          or (la.status in ('failed', 'pending') and la.attempt_count < ${MAX_TESSA_ATTEMPTS})
        )
        and not exists (
          select 1 from prelim_analyses complete
          where complete.document_id = d.id
            and complete.status = 'complete'
        )
      order by coalesce(la.updated_at, d.created_at) asc
      limit 5
    `);
    const candidates = candidateRows as unknown as TessaCandidateRow[];

    for (const row of candidates) {
      const nextAttempt = row.attempt_count + 1;
      try {
        console.log(`[TESSA] Running analysis for order ${row.order_id}, doc ${row.document_id}, attempt ${nextAttempt}`);
        const result = await analyzePrelim({
          orderId: row.order_id,
          documentId: row.document_id,
          fileNumber: row.file_number,
          storageKey: row.storage_key,
          triggeredBy: 'cron',
          attemptCount: nextAttempt,
        });
        if (result.status === 'failed' && nextAttempt >= MAX_TESSA_ATTEMPTS && result.analysisId > 0) {
          await markTessaRetryCapReached(result.analysisId, result.error ?? 'Analysis failed');
        }
        retried++;
      } catch (err) {
        if (nextAttempt >= MAX_TESSA_ATTEMPTS && row.analysis_id !== null) {
          await markTessaRetryCapReached(row.analysis_id, err instanceof Error ? err.message : 'Unknown retry failure');
        }
        console.error('[TESSA] Retry failed:', {
          orderId: row.order_id,
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
  if (urls.length === 0) {
    // Distinguish "SoftPro has nothing" from "SoftPro sent a shape we drop".
    // Both were a bare skip before, which is why the Title & Escrow gap
    // (8 of 418 orders with a prelim) had no explanation in the logs.
    const items = Array.isArray(result.data) ? result.data : [];
    if (items.length === 0) {
      console.log(`[fetch-prelims] ${fileNumber}: SoftPro returned no attached documents`);
    } else {
      console.warn(
        `[fetch-prelims] ${fileNumber}: ${items.length} attached document(s) returned but none were URL strings`,
        JSON.stringify(describeAttachedDocuments(result.data)),
      );
    }
    return 0;
  }

  let stored = 0;
  for (const url of urls) {
    try {
      // Same ingest path as the prelim webhook (identity dedupe + SoftPro-origin stamp).
      const result = await ingestPrelimFromSoftPro({
        orderId,
        fileNumber,
        documentUrl: url,
        source: 'softpro_fetch',
        createdBy: 'job:fetch_prelims',
        deliver: true,
        triggeredBy: 'fetch_prelims',
      });

      if (result.outcome !== 'ingested') continue;

      try {
        if (isTessaAutoAnalysisEnabled()) {
          await analyzePrelim({
            orderId,
            documentId: result.documentId,
            fileNumber,
            storageKey: result.storageKey,
            triggeredBy: 'cron',
          });
        }
      } catch (err) {
        console.error('[TESSA] Cron-triggered analysis failed:', {
          orderId,
          documentId: result.documentId,
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
