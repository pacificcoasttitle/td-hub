import { db } from '@/lib/db/client';
import { orders, documents, prelimAnalyses } from '@/lib/db/schema';
import { sql, and, eq, or, isNull } from 'drizzle-orm';
import { expectsPctEscrowOfficer } from '@/lib/domain/orders/escrow-officer-expectation';
import { getAttachedDocuments, getAttachedDocumentsPrelim } from '@/lib/integrations/softpro';
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
 * from SoftPro. Title-only uses GetAttachedDocuments; Title & Escrow
 * and Escrow-only use GetAttachedDocumentsPrelim. Downloaded PDFs
 * are stored in S3 and recorded in the documents table.
 */
export async function handleFetchPrelims(): Promise<FetchPrelimsResult> {
  // Orders attempted within the last 6 hours are skipped to prevent the cron
  // from re-polling the same unproductive files every cycle.
  //
  // ORDERING, both halves of which are load-bearing.
  //
  // `nulls first` is written out because Postgres does the opposite by default:
  // `ORDER BY col ASC` is `NULLS LAST`, so plain `asc()` served never-attempted
  // orders LAST, behind every previously-attempted order that had aged past the
  // 6-hour window. The comment here used to claim "asc nulls first" while the
  // code did the reverse, and the effect was starvation: on 2026-08-27, 48
  // recycling rows sorted ahead of 118 never-attempted ones against a limit of
  // 50, so roughly two new orders were examined per cycle. 113 freshly imported
  // orders sat untouched, and a genuinely new order's prelim queued behind them.
  //
  // The secondary sort is what keeps `nulls first` from inverting the problem.
  // Never-attempted is one undifferentiated group, and a backfill drops hundreds
  // of rows into it at once; without a tiebreak, today's orders compete with a
  // 2025 import for the same slots in arbitrary order. Newest-first means live
  // work is always served before historical, and the backfill drains on
  // whatever capacity is left.
  //
  // `coalesce(opened_at, created_at)` rather than `opened_at` alone because
  // opened_at is legitimately NULL on first insert — GetOrders carries no open
  // date and enrich_order_details fills it in later — so ordering on it directly
  // would push every brand-new order to the back. Falling back to row-creation
  // time keeps a fresh order at the front during that gap.
  //
  // RESIDUAL HOLE: an imported order is also newly created, so between its
  // insert and its enrichment it looks new by this measure and can still be
  // served ahead of live work. The window is a few minutes and the prelim
  // backfill gate makes the outcome harmless, but the durable answer is
  // provenance recorded at write time rather than inferred from timestamps —
  // the same conclusion orders.opened_at reached.
  const ordersWithoutPrelims = await db
    .select({ id: orders.id, fileNumber: orders.fileNumber, orderType: orders.orderType })
    .from(orders)
    .where(and(
      sql`${orders.operationalStatus} in ('open', 'in_process', 'completed')`,
      sql`${orders.id} NOT IN (SELECT order_id FROM documents WHERE category = 'prelim' AND status = 'active')`,
      or(
        isNull(orders.lastPrelimFetchAt),
        sql`${orders.lastPrelimFetchAt} < NOW() - INTERVAL '6 hours'`,
      ),
    ))
    .orderBy(sql`${orders.lastPrelimFetchAt} asc nulls first, coalesce(${orders.openedAt}, ${orders.createdAt}) desc`)
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
      const stored = await fetchPrelimsForOrder(order.id, order.fileNumber, order.orderType);
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
 *
 * Title & Escrow / Escrow-only prelims live on GetAttachedDocumentsPrelim.
 * GetAttachedDocuments is blind to them — that is why 546 T&E PDFs had to be
 * backfilled. Title-only stays on the general endpoint.
 */
export function attachedDocumentsCallFor(orderType: string | null | undefined): 'prelim' | 'general' {
  return expectsPctEscrowOfficer(orderType) ? 'prelim' : 'general';
}

export async function fetchPrelimsForOrder(
  orderId: number,
  fileNumber: string,
  orderType?: string | null,
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

  const result = attachedDocumentsCallFor(orderType) === 'prelim'
    ? await getAttachedDocumentsPrelim(fileNumber)
    : await getAttachedDocuments(fileNumber);

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
        // Fetch is the live send path. The webhook has never fired once.
        // Age is SoftPro's document date, else the order open date — never
        // hub created_at. Older than three Pacific days is held; recent
        // prelims mail. See docs/tickets/PRELIM_AGE_GUARD.md.
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
