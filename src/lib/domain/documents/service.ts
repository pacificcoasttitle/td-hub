import { db } from '@/lib/db/client';
import { documents, documentAudit, orders, documentRequests, eventOutbox } from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { uploadFile as s3Upload } from '@/lib/integrations/s3/client';
import { uploadDocument as softproUpload } from '@/lib/integrations/softpro/client';
import {
  extractSoftProDocumentId,
  softProAttachNextRetryAt,
} from './softpro-attach-retry';
import { softProDocumentName } from './softpro-document-name';
import { buildSoftProFetchUrl } from './softpro-fetch-token';

// ─── Types ───────────────────────────────────────────────────────────────────

type DocCategory = (typeof documents.category.enumValues)[number];

export interface UploadDocumentParams {
  orderId: number;
  file: Buffer;
  filename: string;
  contentType: string;
  category: DocCategory;
  description?: string;
  userId: string;
}

export interface AttachToSoftProResult {
  success: boolean;
  error?: string;
  softproDocumentId?: string;
}

// ─── Commands ────────────────────────────────────────────────────────────────

export async function uploadDocument(
  params: UploadDocumentParams
): Promise<{ documentId: number; storageKey: string }> {
  const storageKey = `${params.category}/${params.filename}`;

  const uploadResult = await s3Upload({
    key: storageKey,
    buffer: params.file,
    contentType: params.contentType,
  });

  if (!uploadResult.success) {
    throw new Error(uploadResult.error?.message ?? 'S3 upload failed');
  }

  const [doc] = await db
    .insert(documents)
    .values({
      orderId: params.orderId,
      category: params.category,
      filename: params.filename,
      originalFilename: params.filename,
      storageProvider: 's3',
      storageKey,
      contentType: params.contentType,
      sizeBytes: params.file.length,
      status: 'active',
      description: params.description ?? null,
      createdBy: params.userId,
    })
    .returning({ id: documents.id });

  await db.insert(documentAudit).values({
    documentId: doc!.id,
    action: 'uploaded',
    byUserId: params.userId,
    meta: {
      filename: params.filename,
      contentType: params.contentType,
      sizeBytes: params.file.length,
      storageKey,
    } as Record<string, unknown>,
  });

  try {
    await autoFulfillRequests(params.orderId, params.category, doc!.id);
  } catch { /* auto-fulfill is best-effort */ }

  return { documentId: doc!.id, storageKey };
}

export async function deleteDocument(id: number, userId: string): Promise<void> {
  const doc = await getDocumentById(id);
  if (!doc) throw new Error('Document not found');

  await db
    .update(documents)
    .set({ status: 'deleted', updatedAt: new Date() })
    .where(eq(documents.id, id));

  await db.insert(documentAudit).values({
    documentId: id,
    action: 'deleted',
    byUserId: userId,
    meta: { filename: doc.filename, storageKey: doc.storageKey } as Record<string, unknown>,
  });
}

// ─── Attach to SoftPro ───────────────────────────────────────────────────────

/**
 * Push a TD Hub document into SoftPro via AddDocuments.
 * Never throws for SoftPro/API failures — always records success or failure on the documents row.
 * Callers may await this without blocking the user-facing operation on SoftPro outcome.
 */
export async function attachToSoftPro(
  documentId: number,
  folderName?: string,
): Promise<AttachToSoftProResult> {
  try {
    const doc = await getDocumentById(documentId);
    if (!doc) return { success: false, error: 'Document not found' };
    if (doc.status === 'deleted') return { success: false, error: 'Document is deleted' };
    if (doc.isSyncedToSoftpro && doc.softproDocumentId) {
      return { success: true, softproDocumentId: doc.softproDocumentId };
    }

    const orderRow = await db
      .select({ id: orders.id, fileNumber: orders.fileNumber })
      .from(orders)
      .where(eq(orders.id, doc.orderId))
      .limit(1);

    if (orderRow.length === 0) {
      await recordAttachFailure(documentId, 'Order not found', null);
      return { success: false, error: 'Order not found' };
    }
    const { id: orderId, fileNumber } = orderRow[0]!;

    // SoftPro downloads FileURL on a Windows host (MAX_PATH 260).
    // Long pre-signed S3 URLs (~440+ chars) cause SoftPro to fail with path-too-long.
    // Use a short HMAC-gated proxy URL that streams the bytes.
    let fileUrl: string;
    try {
      fileUrl = buildSoftProFetchUrl(documentId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to build SoftPro fetch URL';
      await recordAttachFailure(documentId, message, fileNumber);
      return { success: false, error: message };
    }

    const documentName = softProDocumentName({
      documentId,
      category: doc.category,
      filename: doc.filename,
    });

    const result = await softproUpload({
      documentId,
      orderId,
      orderNumber: fileNumber,
      documentName,
      folderName: folderName ?? doc.category,
      fileUrl,
    });

    if (result.success) {
      const softproDocumentId = extractSoftProDocumentId(result.data, documentId);
      const attemptCount = (doc.softproAttachAttemptCount ?? 0) + 1;

      await db.update(documents).set({
        isSyncedToSoftpro: true,
        softproSyncedAt: new Date(),
        softproSyncError: null,
        softproDocumentId,
        softproAttachAttemptCount: attemptCount,
        softproAttachNextRetryAt: null,
        updatedAt: new Date(),
      }).where(eq(documents.id, documentId));

      await db.insert(documentAudit).values({
        documentId,
        action: 'attached_to_softpro',
        meta: {
          fileNumber,
          fileUrl,
          documentName,
          softproDocumentId,
          requestId: result.requestId,
          attemptCount,
        } as Record<string, unknown>,
      });

      return { success: true, softproDocumentId };
    }

    const errorMessage = result.error?.message ?? 'SoftPro upload failed';
    await recordAttachFailure(documentId, errorMessage, fileNumber, {
      fileUrl,
      documentName,
      requestId: result.requestId,
      priorAttempts: doc.softproAttachAttemptCount ?? 0,
    });
    return { success: false, error: errorMessage };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'SoftPro attach failed unexpectedly';
    try {
      await recordAttachFailure(documentId, errorMessage, null);
    } catch { /* last-resort: never throw to callers */ }
    return { success: false, error: errorMessage };
  }
}

async function recordAttachFailure(
  documentId: number,
  errorMessage: string,
  fileNumber: string | null,
  meta?: Record<string, unknown>,
): Promise<void> {
  const existing = await getDocumentById(documentId);
  const attemptCount = (existing?.softproAttachAttemptCount ?? 0) + 1;
  const nextRetryAt = softProAttachNextRetryAt(attemptCount);

  await db.update(documents).set({
    isSyncedToSoftpro: false,
    softproSyncError: errorMessage.slice(0, 2000),
    softproAttachAttemptCount: attemptCount,
    softproAttachNextRetryAt: nextRetryAt,
    updatedAt: new Date(),
  }).where(eq(documents.id, documentId));

  await db.insert(documentAudit).values({
    documentId,
    action: 'attach_failed',
    meta: {
      fileNumber,
      error: errorMessage,
      attemptCount,
      nextRetryAt: nextRetryAt?.toISOString() ?? null,
      ...meta,
    } as Record<string, unknown>,
  });
}

// ─── Queries ─────────────────────────────────────────────────────────────────

export async function getDocumentsByOrder(orderId: number) {
  return db
    .select()
    .from(documents)
    .where(eq(documents.orderId, orderId))
    .orderBy(desc(documents.createdAt));
}

export async function getDocumentById(id: number) {
  const result = await db
    .select()
    .from(documents)
    .where(eq(documents.id, id))
    .limit(1);
  return result[0] ?? null;
}

// ─── Auto-Fulfill Document Requests ────────────────────────────────────────

const REQUEST_TYPE_TO_CATEGORY: Record<string, string[]> = {
  prelim: ['prelim'],
  cpl: ['cpl'],
  policy: ['policy'],
  title_search: ['legal_vesting', 'grant_deed', 'tax'],
  general: ['general', 'user_upload'],
};

async function autoFulfillRequests(
  orderId: number,
  category: string,
  documentId: number,
): Promise<void> {
  const matchingTypes = Object.entries(REQUEST_TYPE_TO_CATEGORY)
    .filter(([, cats]) => cats.includes(category))
    .map(([type]) => type);

  if (matchingTypes.length === 0) return;

  const pending = await db
    .select()
    .from(documentRequests)
    .where(and(
      eq(documentRequests.orderId, orderId),
      eq(documentRequests.status, 'pending'),
    ));

  const toFulfill = pending.filter(r => matchingTypes.includes(r.requestType));
  if (toFulfill.length === 0) return;

  for (const req of toFulfill) {
    await db.update(documentRequests).set({
      status: 'fulfilled',
      fulfilledDocumentId: documentId,
      updatedAt: new Date(),
    }).where(eq(documentRequests.id, req.id));

    await db.insert(eventOutbox).values({
      eventType: 'document_request.auto_fulfilled',
      orderId,
      payload: {
        requestId: req.id,
        documentId,
        requestedBy: req.requestedBy,
        requestType: req.requestType,
        category,
      } as Record<string, unknown>,
    });
  }
}
