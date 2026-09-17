/**
 * One-shot Title & Escrow prelim ingest. Not a cron. Not the live fetch_prelims handler.
 *
 * This recovery is DOCUMENT fetch lag: T&E prelims issued months ago and
 * fetched now are not news. Fetch and this backfill both hardcode
 * `deliver: false`. Only the prelim webhook can mail. See
 * backfill-te-prelims.test.ts.
 *
 * SoftPro endpoint is GetAttachedDocumentsPrelim (T&E only). Title-only and
 * the live cron stay on GetAttachedDocuments. TESSA is not called here.
 */

import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { documents, orders } from '@/lib/db/schema';
import { ingestPrelimFromSoftPro } from '@/lib/domain/documents/ingest-prelim-from-softpro';
import { getAttachedDocumentsPrelim } from '@/lib/integrations/softpro';
import { describeAttachedDocuments } from '@/lib/integrations/softpro/client';

export const TE_PRELIM_BACKFILL_CREATED_BY = 'job:backfill_te_prelims';

export interface BackfillTePrelimsInput {
  limit: number;
}

export interface BackfillTePrelimError {
  fileNumber: string;
  error: string;
}

export interface BackfillTePrelimsResult {
  eligible: number;
  attempted: number;
  stored: number;
  skipped: number;
  errors: BackfillTePrelimError[];
  fileNumbers: string[];
}

function extractUrls(data: unknown): string[] {
  if (Array.isArray(data)) {
    return data.filter((item): item is string => typeof item === 'string' && item.startsWith('http'));
  }
  return [];
}

export async function backfillTePrelimsWithoutDelivery(
  input: BackfillTePrelimsInput,
): Promise<BackfillTePrelimsResult> {
  const limit = Math.max(0, Math.floor(input.limit));
  const result: BackfillTePrelimsResult = {
    eligible: 0,
    attempted: 0,
    stored: 0,
    skipped: 0,
    errors: [],
    fileNumbers: [],
  };
  if (limit === 0) return result;

  const candidates = await db
    .select({ id: orders.id, fileNumber: orders.fileNumber })
    .from(orders)
    .where(and(
      eq(orders.orderType, 'Title & Escrow'),
      sql`${orders.operationalStatus} in ('open', 'in_process', 'completed')`,
      sql`${orders.id} NOT IN (
        SELECT order_id FROM documents
        WHERE category = 'prelim' AND status = 'active'
      )`,
    ))
    .orderBy(sql`coalesce(${orders.openedAt}, ${orders.createdAt}) desc`)
    .limit(limit);

  result.eligible = candidates.length;

  for (const order of candidates) {
    result.attempted++;
    result.fileNumbers.push(order.fileNumber);
    try {
      const stored = await ingestTePrelimWithoutDelivery(order.id, order.fileNumber);
      if (stored > 0) result.stored += stored;
      else result.skipped++;
    } catch (err) {
      result.errors.push({
        fileNumber: order.fileNumber,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  return result;
}

async function ingestTePrelimWithoutDelivery(
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

  if (existing && existing.count > 0) return 0;

  const listed = await getAttachedDocumentsPrelim(fileNumber);

  await db.update(orders)
    .set({ lastPrelimFetchAt: sql`NOW()` })
    .where(eq(orders.id, orderId));

  if (!listed.success || !listed.data) return 0;

  const urls = extractUrls(listed.data);
  if (urls.length === 0) {
    const items = Array.isArray(listed.data) ? listed.data : [];
    if (items.length === 0) {
      console.log(`[backfill-te-prelims] ${fileNumber}: GetAttachedDocumentsPrelim returned no documents`);
    } else {
      console.warn(
        `[backfill-te-prelims] ${fileNumber}: ${items.length} item(s) returned but none were URL strings`,
        JSON.stringify(describeAttachedDocuments(listed.data)),
      );
    }
    return 0;
  }

  let stored = 0;
  for (const url of urls) {
    try {
      const ingested = await ingestPrelimFromSoftPro({
        orderId,
        fileNumber,
        documentUrl: url,
        source: 'softpro_fetch',
        createdBy: TE_PRELIM_BACKFILL_CREATED_BY,
        deliver: false,
        triggeredBy: 'fetch_prelims',
      });
      if (ingested.outcome === 'ingested') stored++;
    } catch { /* per-URL failure does not stop the batch */ }
  }

  return stored;
}
