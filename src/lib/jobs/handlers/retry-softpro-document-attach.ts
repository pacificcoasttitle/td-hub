import { and, asc, eq, isNull, lt, lte, or } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { documents } from '@/lib/db/schema';
import { attachToSoftPro } from '@/lib/domain/documents/service';
import { SOFTPRO_ATTACH_MAX_ATTEMPTS } from '@/lib/domain/documents/softpro-attach-retry';

export interface RetrySoftProDocumentAttachResult {
  total: number;
  attempted: number;
  synced: number;
  failed: number;
  skipped: number;
  errors: Array<{ documentId: number; error: string }>;
}

const BATCH_LIMIT = 25;
const TIME_BUDGET_MS = 240_000;

/**
 * Re-attempt SoftPro AddDocuments for unsynced active documents with backoff.
 * Regenerates a fresh short fetch URL on each attempt (tokens expire).
 */
export async function handleRetrySoftProDocumentAttach(): Promise<RetrySoftProDocumentAttachResult> {
  const now = new Date();

  const candidates = await db
    .select({
      id: documents.id,
      category: documents.category,
      softproAttachAttemptCount: documents.softproAttachAttemptCount,
    })
    .from(documents)
    .where(and(
      eq(documents.status, 'active'),
      eq(documents.isSyncedToSoftpro, false),
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

  for (const doc of candidates) {
    if (Date.now() - start > TIME_BUDGET_MS) {
      skipped += candidates.length - attempted;
      break;
    }

    attempted++;
    const folder =
      doc.category === 'cpl' ? 'CPL'
        : doc.category === 'proposed_insured' ? 'desk-file-upload'
          : ['legal_vesting', 'grant_deed', 'tax'].includes(doc.category) ? 'Title Docs'
            : undefined;

    const result = await attachToSoftPro(doc.id, folder);
    if (result.success) {
      synced++;
    } else {
      failed++;
      errors.push({ documentId: doc.id, error: result.error ?? 'attach failed' });
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
