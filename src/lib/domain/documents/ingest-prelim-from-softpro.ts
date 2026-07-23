/**
 * Shared SoftPro → Hub prelim ingest path used by:
 * - softpro.fetch_prelims cron (safety net)
 * - /api/webhooks/softpro/prelim (fast path)
 *
 * SoftPro-origin docs are stamped is_synced_to_softpro=true so they are
 * never write-back-push eligible (retry allowlist invariant).
 */

import { createHash } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { documentAudit, documents } from '@/lib/db/schema';
import { uploadFile as s3Upload } from '@/lib/integrations/s3/client';
import { maybeAutoDeliverPrelim, type PrelimAutoDeliveryResult } from '@/lib/domain/notifications/prelim-auto-delivery';

export type SoftProPrelimIngestSource = 'softpro_fetch' | 'softpro_webhook';

export interface SoftProPrelimIdentity {
  sourceUrl: string;
  storedDocumentName?: string | null;
  checksum: string;
}

export interface IngestPrelimFromSoftProInput {
  orderId: number;
  fileNumber: string;
  documentUrl: string;
  storedDocumentName?: string | null;
  /** SoftPro event time — used to decide "newer" vs stale when order already has a prelim. */
  occurredAt?: Date | null;
  source: SoftProPrelimIngestSource;
  createdBy: string;
  /** When true (webhook update path), call maybeAutoDeliverPrelim after ingest. Cron always delivers. */
  deliver: boolean;
  triggeredBy: 'fetch_prelims' | 'softpro_webhook';
}

export type IngestPrelimOutcome =
  | { outcome: 'deduped'; documentId: number; reason: string }
  | { outcome: 'stale'; documentId: number | null; reason: string }
  | {
      outcome: 'ingested';
      documentId: number;
      checksum: string;
      storageKey: string;
      isUpdate: boolean;
      delivery: PrelimAutoDeliveryResult | null;
    };

export function checksumBuffer(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export function normalizeDocName(name: string | null | undefined): string | null {
  const trimmed = name?.trim();
  return trimmed ? trimmed.toLowerCase() : null;
}

export function identitiesMatch(
  existing: {
    checksum: string | null;
    filename: string;
    originalFilename: string | null;
    sourceUrl?: string | null;
    storedDocumentName?: string | null;
  },
  incoming: SoftProPrelimIdentity,
): boolean {
  if (existing.checksum && existing.checksum === incoming.checksum) return true;

  const incomingUrl = incoming.sourceUrl.trim();
  if (existing.sourceUrl && existing.sourceUrl.trim() === incomingUrl) return true;

  const incomingName = normalizeDocName(incoming.storedDocumentName);
  if (incomingName) {
    if (normalizeDocName(existing.storedDocumentName) === incomingName) return true;
    if (normalizeDocName(existing.filename) === incomingName) return true;
    if (normalizeDocName(existing.originalFilename) === incomingName) return true;
  }

  return false;
}

/**
 * "Newer" for an order that already has active prelim(s):
 * - different identity (caller already checked), AND
 * - OccurredAt is absent/invalid OR OccurredAt >= latest known prelim timestamp
 *   (max of document.created_at and audit meta.occurredAt).
 *
 * A repeat of the same identity is handled by dedupe (never reaches this).
 */
export function isNewerThanExisting(
  occurredAt: Date | null | undefined,
  latestExistingAt: Date | null,
): boolean {
  if (!latestExistingAt) return true;
  if (!occurredAt || Number.isNaN(occurredAt.getTime())) return true;
  return occurredAt.getTime() >= latestExistingAt.getTime();
}

export async function downloadPrelimFromUrl(
  url: string,
  preferredFilename?: string | null,
): Promise<{ buffer: Buffer; filename: string }> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status} from ${url}`);

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const fromUrl = new URL(url).pathname.split('/').pop() ?? `prelim_${Date.now()}.pdf`;
  const filename = (preferredFilename?.trim() || fromUrl).replace(/[\\/]/g, '_');
  return { buffer, filename };
}

type ExistingPrelimRow = {
  id: number;
  checksum: string | null;
  filename: string;
  originalFilename: string | null;
  createdAt: Date;
  sourceUrl: string | null;
  storedDocumentName: string | null;
  occurredAt: Date | null;
};

async function loadExistingPrelims(orderId: number): Promise<ExistingPrelimRow[]> {
  const docs = await db
    .select({
      id: documents.id,
      checksum: documents.checksum,
      filename: documents.filename,
      originalFilename: documents.originalFilename,
      createdAt: documents.createdAt,
    })
    .from(documents)
    .where(and(
      eq(documents.orderId, orderId),
      eq(documents.category, 'prelim'),
      eq(documents.status, 'active'),
    ))
    .orderBy(desc(documents.createdAt), desc(documents.id));

  const rows: ExistingPrelimRow[] = [];
  for (const doc of docs) {
    const [audit] = await db
      .select({ meta: documentAudit.meta })
      .from(documentAudit)
      .where(and(
        eq(documentAudit.documentId, doc.id),
        eq(documentAudit.action, 'uploaded'),
      ))
      .orderBy(desc(documentAudit.performedAt), desc(documentAudit.id))
      .limit(1);

    const meta = (audit?.meta ?? {}) as Record<string, unknown>;
    const sourceUrl = typeof meta.sourceUrl === 'string' ? meta.sourceUrl : null;
    const storedDocumentName = typeof meta.storedDocumentName === 'string'
      ? meta.storedDocumentName
      : null;
    let occurredAt: Date | null = null;
    if (typeof meta.occurredAt === 'string') {
      const parsed = new Date(meta.occurredAt);
      if (!Number.isNaN(parsed.getTime())) occurredAt = parsed;
    }

    rows.push({
      ...doc,
      sourceUrl,
      storedDocumentName,
      occurredAt,
    });
  }
  return rows;
}

function latestExistingTimestamp(rows: ExistingPrelimRow[]): Date | null {
  let latest: Date | null = null;
  for (const row of rows) {
    const candidates = [row.createdAt, row.occurredAt].filter((d): d is Date => !!d);
    for (const d of candidates) {
      if (!latest || d.getTime() > latest.getTime()) latest = d;
    }
  }
  return latest;
}

/**
 * Download + store a SoftPro prelim with identity-based idempotency.
 * Same URL / StoredDocumentName / content hash → NO-OP (no duplicate row, no re-delivery).
 */
export async function ingestPrelimFromSoftPro(
  input: IngestPrelimFromSoftProInput,
): Promise<IngestPrelimOutcome> {
  const { buffer, filename } = await downloadPrelimFromUrl(
    input.documentUrl,
    input.storedDocumentName,
  );
  const checksum = checksumBuffer(buffer);
  const identity: SoftProPrelimIdentity = {
    sourceUrl: input.documentUrl,
    storedDocumentName: input.storedDocumentName ?? filename,
    checksum,
  };

  const existing = await loadExistingPrelims(input.orderId);
  const match = existing.find((row) => identitiesMatch(row, identity));
  if (match) {
    return {
      outcome: 'deduped',
      documentId: match.id,
      reason: 'prelim identity already stored (url / name / checksum)',
    };
  }

  const isUpdate = existing.length > 0;
  if (isUpdate && !isNewerThanExisting(input.occurredAt ?? null, latestExistingTimestamp(existing))) {
    return {
      outcome: 'stale',
      documentId: existing[0]?.id ?? null,
      reason: 'incoming OccurredAt is older than latest stored prelim',
    };
  }

  const ts = Date.now();
  const storageKey = `prelim-upload-doc/${input.fileNumber}/${ts}_${filename}`;
  const upload = await s3Upload({ key: storageKey, buffer, contentType: 'application/pdf' });
  if (!upload.success) {
    throw new Error(upload.error?.message ?? 'S3 upload failed');
  }

  const [doc] = await db.insert(documents).values({
    orderId: input.orderId,
    category: 'prelim',
    filename,
    originalFilename: input.storedDocumentName?.trim() || filename,
    storageProvider: 's3',
    storageKey,
    contentType: 'application/pdf',
    sizeBytes: buffer.length,
    checksum,
    status: 'active',
    description: input.source === 'softpro_webhook'
      ? `Received via SoftPro prelim webhook for ${input.fileNumber}`
      : `Prelim fetched from SoftPro for ${input.fileNumber}`,
    // SoftPro-origin — never write-back-push eligible
    isSyncedToSoftpro: true,
    softproSyncedAt: new Date(),
    createdBy: input.createdBy,
  }).returning({ id: documents.id, createdAt: documents.createdAt });

  await db.insert(documentAudit).values({
    documentId: doc!.id,
    action: 'uploaded',
    byUserId: input.createdBy,
    meta: {
      source: input.source,
      sourceUrl: input.documentUrl,
      storedDocumentName: input.storedDocumentName ?? filename,
      occurredAt: input.occurredAt?.toISOString() ?? null,
      checksum,
      storageKey,
      sizeBytes: buffer.length,
      isUpdate,
    } as Record<string, unknown>,
  });

  let delivery: PrelimAutoDeliveryResult | null = null;
  if (input.deliver) {
    delivery = await maybeAutoDeliverPrelim({
      orderId: input.orderId,
      documentId: doc!.id,
      documentCreatedAt: doc!.createdAt,
      triggeredBy: input.triggeredBy,
    });
  }

  return {
    outcome: 'ingested',
    documentId: doc!.id,
    checksum,
    storageKey,
    isUpdate,
    delivery,
  };
}
