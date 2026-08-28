import { and, asc, eq, inArray, isNull, lt, lte, or } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { documents } from '@/lib/db/schema';
import { attachTitleDocsToSoftPro, attachToSoftPro } from '@/lib/domain/documents/service';
import { isTitleDocCategory, softProFolderForCategory } from '@/lib/domain/documents/softpro-folder';
import { SOFTPRO_ATTACH_MAX_ATTEMPTS } from '@/lib/domain/documents/softpro-attach-retry';
import { budgetMsFor } from '@/lib/jobs/time-budget';

export interface RetrySoftProDocumentAttachResult {
  total: number;
  attempted: number;
  synced: number;
  failed: number;
  skipped: number;
  errors: Array<{ documentId: number; error: string }>;
}

const BATCH_LIMIT = 25;
const TIME_BUDGET_MS = budgetMsFor('softpro.retry_document_attach');

/**
 * Categories TD Hub generates and may push to SoftPro.
 * Never include SoftPro-fetched categories (prelim, policy) — those already live in SoftPro.
 */
export const SOFTPRO_RETRY_ATTACH_CATEGORIES = [
  'cpl',
  'proposed_insured',
  'legal_vesting',
  'tax',
  'grant_deed',
] as const;

/**
 * Re-attempt SoftPro AddDocuments for unsynced active TD-Hub-generated documents.
 * Title docs (LV / grant deed / tax) are batched per order into one FileList.
 * CPL and proposed-insured stay single-file posts.
 */
export async function handleRetrySoftProDocumentAttach(): Promise<RetrySoftProDocumentAttachResult> {
  const now = new Date();

  const candidates = await db
    .select({
      id: documents.id,
      orderId: documents.orderId,
      category: documents.category,
      softproAttachAttemptCount: documents.softproAttachAttemptCount,
    })
    .from(documents)
    .where(and(
      eq(documents.status, 'active'),
      eq(documents.isSyncedToSoftpro, false),
      inArray(documents.category, [...SOFTPRO_RETRY_ATTACH_CATEGORIES]),
      lt(documents.softproAttachAttemptCount, SOFTPRO_ATTACH_MAX_ATTEMPTS),
      or(
        isNull(documents.softproAttachNextRetryAt),
        lte(documents.softproAttachNextRetryAt, now),
      ),
    ))
    .orderBy(
      asc(documents.softproAttachNextRetryAt),
      asc(documents.createdAt),
    )
    .limit(BATCH_LIMIT);

  const start = Date.now();
  let attempted = 0;
  let synced = 0;
  let failed = 0;
  let skipped = 0;
  const errors: Array<{ documentId: number; error: string }> = [];

  const titleByOrder = new Map<number, number[]>();
  const singles: typeof candidates = [];
  for (const doc of candidates) {
    if (isTitleDocCategory(doc.category)) {
      const list = titleByOrder.get(doc.orderId) ?? [];
      list.push(doc.id);
      titleByOrder.set(doc.orderId, list);
    } else {
      singles.push(doc);
    }
  }

  const work: Array<{ kind: 'title'; orderId: number; ids: number[] } | { kind: 'single'; id: number; category: string }> = [
    ...[...titleByOrder.entries()].map(([orderId, ids]) => ({ kind: 'title' as const, orderId, ids })),
    ...singles.map((doc) => ({ kind: 'single' as const, id: doc.id, category: doc.category })),
  ];

  for (const item of work) {
    if (Date.now() - start > TIME_BUDGET_MS) {
      skipped += item.kind === 'title' ? item.ids.length : 1;
      skipped += work.slice(work.indexOf(item) + 1).reduce(
        (n, next) => n + (next.kind === 'title' ? next.ids.length : 1),
        0,
      );
      break;
    }

    if (item.kind === 'title') {
      attempted += item.ids.length;
      const result = await attachTitleDocsToSoftPro(item.orderId);
      if (result.success) {
        synced += item.ids.length;
      } else {
        failed += item.ids.length;
        for (const id of item.ids) {
          errors.push({ documentId: id, error: result.error ?? 'attach failed' });
        }
      }
      continue;
    }

    attempted++;
    const result = await attachToSoftPro(item.id, softProFolderForCategory(item.category));
    if (result.success) {
      synced++;
    } else {
      failed++;
      errors.push({ documentId: item.id, error: result.error ?? 'attach failed' });
    }
  }

  return {
    total: candidates.length,
    attempted,
    synced,
    failed,
    skipped,
    errors,
  };
}
