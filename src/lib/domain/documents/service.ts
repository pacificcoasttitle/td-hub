import { db } from '@/lib/db/client';
import { documents, documentAudit, orders, documentRequests, eventOutbox, titlePointData, vendorApiLogs } from '@/lib/db/schema';
import { eq, and, desc, inArray } from 'drizzle-orm';
import { uploadFile as s3Upload } from '@/lib/integrations/s3/client';
import {
  getAttachedDocuments,
  uploadDocument as softproUpload,
} from '@/lib/integrations/softpro/client';
import {
  SOFTPRO_ATTACH_MAX_ATTEMPTS,
  extractSoftProDocumentId,
  softProAlreadyExistsByName,
  softProAttachNextRetryAt,
} from './softpro-attach-retry';
import {
  classifyTitleDocAttach,
  type SoftProAcceptSource,
} from './softpro-attach-verify';
import { softProDocumentName } from './softpro-document-name';
import { buildSoftProFetchUrl } from './softpro-fetch-token';
import {
  SOFTPRO_TITLE_DOC_CATEGORIES,
  attachedNamesFromGetAttached,
  cleanSoftProFileUrl,
  countSentAmongAttached,
  isTitleDocCategory,
  softProFolderForCategory,
} from './softpro-folder';

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
  deferred?: boolean;
  sent?: number;
  attached?: number;
}

const TITLE_POINT_IN_FLIGHT = ['pending', 'processing', 'ready', 'result_ready'] as const;

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

    if (isTitleDocCategory(doc.category)) {
      return attachTitleDocsToSoftPro(orderId);
    }

    const documentName = softProDocumentName({
      documentId,
      category: doc.category,
      filename: doc.filename,
    });

    // SoftPro downloads FileURL on a Windows host (MAX_PATH 260).
    // Long pre-signed S3 URLs (~440+ chars) cause SoftPro to fail with path-too-long.
    // Last path segment must be a legal filename — Path.GetFileName uses it.
    let fileUrl: string;
    try {
      fileUrl = cleanSoftProFileUrl(buildSoftProFetchUrl(documentId, documentName));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to build SoftPro fetch URL';
      await recordAttachFailure(documentId, message, fileNumber);
      return { success: false, error: message };
    }

    const result = await softproUpload({
      documentId,
      orderId,
      orderNumber: fileNumber,
      documentName,
      folderName: softProFolderForCategory(doc.category, folderName),
      fileUrl,
    });

    const writeError = result.success ? null : (result.error?.message ?? 'SoftPro upload failed');
    const writeAccepted = result.success || softProAlreadyExistsByName(writeError ?? '');

    if (!writeAccepted) {
      const errorMessage = writeError ?? 'SoftPro upload failed';
      await recordAttachFailure(documentId, errorMessage, fileNumber, {
        fileUrl,
        documentName,
        requestId: result.requestId,
        priorAttempts: doc.softproAttachAttemptCount ?? 0,
      });
      return { success: false, error: errorMessage };
    }

    // Always list. Empty after write accept is accepted, not failed.
    // Confirmed only when this name is on a listing we trust.
    const listed = await getAttachedDocuments(fileNumber);
    const attachedNames = listed.success
      ? attachedNamesFromGetAttached(listed.data)
      : [];
    const landed = attachedNames.some((n) => n.toLowerCase() === documentName.toLowerCase());
    const classified = classifyTitleDocAttach({
      writeSuccess: result.success,
      writeError,
      listed: landed,
    });

    const softproDocumentId = extractSoftProDocumentId(result.data, documentId);
    const attemptCount = (doc.softproAttachAttemptCount ?? 0) + 1;

    await db.update(documents).set({
      isSyncedToSoftpro: true,
      softproListingConfirmed: classified.listingConfirmed,
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
        listingConfirmed: classified.listingConfirmed,
        acceptSource: classified.acceptSource,
        verifyState: classified.state,
      } as Record<string, unknown>,
    });

    return { success: true, softproDocumentId };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'SoftPro attach failed unexpectedly';
    try {
      await recordAttachFailure(documentId, errorMessage, null);
    } catch { /* last-resort: never throw to callers */ }
    return { success: false, error: errorMessage };
  }
}

async function titlePointTitleDocsInFlight(orderId: number): Promise<boolean> {
  const rows = await db
    .select({ status: titlePointData.status, searchType: titlePointData.searchType })
    .from(titlePointData)
    .where(and(
      eq(titlePointData.orderId, orderId),
      inArray(titlePointData.searchType, [...SOFTPRO_TITLE_DOC_CATEGORIES]),
    ));

  return rows.some((row) =>
    TITLE_POINT_IN_FLIGHT.includes(row.status as (typeof TITLE_POINT_IN_FLIGHT)[number]),
  );
}

/**
 * Wait until LV / tax / grant-deed TitlePoint work is terminal, then post every
 * unsynced title doc for the order in ONE AddDocuments call — legacy's batching.
 */
export async function maybeAttachTitleDocsToSoftPro(orderId: number): Promise<AttachToSoftProResult> {
  if (await titlePointTitleDocsInFlight(orderId)) {
    return { success: true, deferred: true, sent: 0, attached: 0 };
  }
  return attachTitleDocsToSoftPro(orderId);
}

/**
 * Accumulate unsynced legal-vesting / grant-deed / tax rows into one FileList
 * and one AddDocuments POST. Always calls GetAttachedDocuments after a write
 * accept. Empty list is accepted (not failed) — that listing does not see
 * Production Documents subfolders. already-exists is accepted at higher
 * confidence. Real rejects stay failed and retry.
 */
export async function attachTitleDocsToSoftPro(orderId: number): Promise<AttachToSoftProResult> {
  const [orderRow] = await db
    .select({ id: orders.id, fileNumber: orders.fileNumber })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!orderRow) return { success: false, error: 'Order not found' };

  const pending = await db
    .select()
    .from(documents)
    .where(and(
      eq(documents.orderId, orderId),
      eq(documents.status, 'active'),
      eq(documents.isSyncedToSoftpro, false),
      inArray(documents.category, [...SOFTPRO_TITLE_DOC_CATEGORIES]),
    ));

  if (pending.length === 0) {
    return { success: true, sent: 0, attached: 0 };
  }

  const files: Array<{
    id: number;
    documentName: string;
    folderName: string;
    fileUrl: string;
  }> = [];

  try {
    for (const doc of pending) {
      const documentName = softProDocumentName({
        documentId: doc.id,
        category: doc.category,
        filename: doc.filename,
      });
      files.push({
        id: doc.id,
        documentName,
        folderName: softProFolderForCategory(doc.category),
        fileUrl: cleanSoftProFileUrl(buildSoftProFetchUrl(doc.id, documentName)),
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to build SoftPro fetch URL';
    for (const doc of pending) {
      await recordAttachFailure(doc.id, message, orderRow.fileNumber);
    }
    return { success: false, error: message, sent: pending.length, attached: 0 };
  }

  const result = await softproUpload({
    documentId: files[0]!.id,
    orderId,
    orderNumber: orderRow.fileNumber,
    documentName: orderRow.fileNumber,
    files: files.map((f) => ({ folderName: f.folderName, fileUrl: f.fileUrl })),
  });

  const writeError = result.success ? null : (result.error?.message ?? 'SoftPro upload failed');
  const writeAccepted = result.success || softProAlreadyExistsByName(writeError ?? '');

  if (!writeAccepted) {
    for (const file of files) {
      await recordAttachFailure(file.id, writeError!, orderRow.fileNumber, {
        fileUrl: file.fileUrl,
        documentName: file.documentName,
        requestId: result.requestId,
        batched: true,
      });
    }
    return { success: false, error: writeError!, sent: files.length, attached: 0 };
  }

  // Principle stays: always list. Empty list after a write accept is accepted,
  // not failed — GetAttachedDocuments does not see Production Documents
  // subfolders (LV / Grant Deed / Taxes). Do not retry an accept.
  const listed = await getAttachedDocuments(orderRow.fileNumber);
  const attachedNames = listed.success
    ? attachedNamesFromGetAttached(listed.data)
    : [];
  const sentNames = files.map((f) => f.documentName);
  const attachedCount = countSentAmongAttached(sentNames, attachedNames);
  const folders = [...new Set(files.map((f) => f.folderName))];
  const allConfirmed = listed.success && attachedCount === sentNames.length;

  await logTitleDocsAttachVerified({
    orderId,
    fileNumber: orderRow.fileNumber,
    requestId: result.requestId,
    sent: files.map((f) => ({
      documentId: f.id,
      documentName: f.documentName,
      folderName: f.folderName,
    })),
    attachedCount,
    attachedNames,
    folders,
    getAttachedOk: listed.success,
    verified: allConfirmed,
    error: allConfirmed
      ? null
      : (listed.success
        ? `matched ${attachedCount}/${sentNames.length}`
        : (listed.error?.message ?? 'GetAttachedDocuments failed')),
  });

  for (const file of files) {
    const landed = attachedNames.some((n) => n.toLowerCase() === file.documentName.toLowerCase());
    const classified = classifyTitleDocAttach({
      writeSuccess: result.success,
      writeError,
      listed: landed,
    });
    const softproDocumentId = extractSoftProDocumentId(result.data, file.id);
    await markTitleDocSynced(file, orderRow.fileNumber, softproDocumentId, result.requestId, {
      attachedCount,
      listingConfirmed: classified.listingConfirmed,
      acceptSource: classified.acceptSource ?? 'add_documents_200',
      verifyState: classified.state,
    });
  }

  return {
    success: true,
    softproDocumentId: extractSoftProDocumentId(result.data, files[0]!.id),
    sent: sentNames.length,
    attached: attachedCount,
  };
}

async function logTitleDocsAttachVerified(params: {
  orderId: number;
  fileNumber: string;
  requestId?: string;
  sent: Array<{ documentId: number; documentName: string; folderName: string }>;
  attachedCount: number;
  attachedNames: string[];
  folders: string[];
  getAttachedOk: boolean;
  verified: boolean;
  error: string | null;
}): Promise<void> {
  const sentCount = params.sent.length;
  console.info(
    `[title-docs-attach] file=${params.fileNumber} sent=${sentCount} confirmed=${params.attachedCount} folders=${params.folders.join(',')} verified=${params.verified}`,
  );
  try {
    await db.insert(vendorApiLogs).values({
      vendor: 'softpro',
      operation: 'title_docs_attach_verified',
      orderId: params.orderId,
      requestId: params.requestId ?? crypto.randomUUID(),
      startedAt: new Date(),
      endedAt: new Date(),
      success: params.verified,
      requestMeta: {
        fileNumber: params.fileNumber,
        sentCount,
        sent: params.sent,
        folders: params.folders,
      } as Record<string, unknown>,
      responseMeta: {
        attachedCount: params.attachedCount,
        attachedNames: params.attachedNames,
        getAttachedOk: params.getAttachedOk,
        verified: params.verified,
        error: params.error,
      } as Record<string, unknown>,
    });
  } catch { /* observability must not fail the attach */ }
}

async function markTitleDocSynced(
  file: { id: number; fileUrl: string; documentName: string; folderName: string },
  fileNumber: string,
  softproDocumentId: string,
  requestId: string | undefined,
  verify: {
    attachedCount: number;
    listingConfirmed: boolean;
    acceptSource: SoftProAcceptSource;
    verifyState: 'accepted' | 'confirmed' | 'failed';
  },
): Promise<void> {
  const existing = await getDocumentById(file.id);
  await db.update(documents).set({
    isSyncedToSoftpro: true,
    softproListingConfirmed: verify.listingConfirmed,
    softproSyncedAt: new Date(),
    softproSyncError: null,
    softproDocumentId,
    softproAttachAttemptCount: (existing?.softproAttachAttemptCount ?? 0) + 1,
    softproAttachNextRetryAt: null,
    updatedAt: new Date(),
  }).where(eq(documents.id, file.id));

  await db.insert(documentAudit).values({
    documentId: file.id,
    action: 'attached_to_softpro',
    meta: {
      fileNumber,
      fileUrl: file.fileUrl,
      documentName: file.documentName,
      folderName: file.folderName,
      softproDocumentId,
      requestId: requestId ?? null,
      batched: true,
      verifiedAttached: verify.attachedCount,
      listingConfirmed: verify.listingConfirmed,
      acceptSource: verify.acceptSource,
      verifyState: verify.verifyState,
    } as Record<string, unknown>,
  });
}

async function recordAttachFailure(
  documentId: number,
  errorMessage: string,
  fileNumber: string | null,
  meta?: Record<string, unknown>,
): Promise<void> {
  const existing = await getDocumentById(documentId);
  const alreadyExists = softProAlreadyExistsByName(errorMessage);
  const attemptCount = alreadyExists
    ? SOFTPRO_ATTACH_MAX_ATTEMPTS
    : (existing?.softproAttachAttemptCount ?? 0) + 1;
  const nextRetryAt = alreadyExists ? null : softProAttachNextRetryAt(attemptCount);

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
