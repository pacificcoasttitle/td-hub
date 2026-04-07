import { db } from '@/lib/db/client';
import { orders, documents, documentAudit } from '@/lib/db/schema';
import { sql, and } from 'drizzle-orm';
import { getAttachedDocuments } from '@/lib/integrations/softpro';
import { uploadFile as s3Upload } from '@/lib/integrations/s3/client';
import { analyzePrelim } from '@/lib/tessa';

export interface FetchPrelimsResult {
  total: number;
  fetched: number;
  documentsStored: number;
  skipped: number;
  errors: Array<{ fileNumber: string; error: string }>;
}

/**
 * Finds orders without prelim documents and attempts to fetch them
 * from SoftPro's GetAttachedDocuments endpoint. Downloaded PDFs
 * are stored in S3 and recorded in the documents table.
 */
export async function handleFetchPrelims(): Promise<FetchPrelimsResult> {
  const ordersWithoutPrelims = await db
    .select({ id: orders.id, fileNumber: orders.fileNumber })
    .from(orders)
    .where(and(
      sql`${orders.operationalStatus} in ('open', 'in_process')`,
      sql`${orders.id} NOT IN (SELECT order_id FROM documents WHERE category = 'prelim')`,
    ))
    .limit(50);

  let fetched = 0;
  let documentsStored = 0;
  let skipped = 0;
  const errors: Array<{ fileNumber: string; error: string }> = [];

  for (const order of ordersWithoutPrelims) {
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

  return { total: ordersWithoutPrelims.length, fetched, documentsStored, skipped, errors };
}

/**
 * Fetch and store prelim documents for a single order.
 * Returns the number of documents successfully stored.
 */
export async function fetchPrelimsForOrder(
  orderId: number,
  fileNumber: string,
): Promise<number> {
  const result = await getAttachedDocuments(fileNumber);
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
        console.error('[TESSA] Cron-triggered analysis failed:', err);
        // Continue processing other prelims / URLs
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
