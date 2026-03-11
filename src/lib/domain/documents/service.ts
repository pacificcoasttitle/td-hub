import { db } from '@/lib/db/client';
import { documents, documentAudit, orders } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { uploadFile as s3Upload } from '@/lib/integrations/s3/client';
import { uploadDocument as softproUpload } from '@/lib/integrations/softpro/client';

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

export async function attachToSoftPro(
  documentId: number
): Promise<{ success: boolean; error?: string }> {
  const doc = await getDocumentById(documentId);
  if (!doc) return { success: false, error: 'Document not found' };
  if (doc.status === 'deleted') return { success: false, error: 'Document is deleted' };

  const orderRow = await db
    .select({ fileNumber: orders.fileNumber })
    .from(orders)
    .where(eq(orders.id, doc.orderId))
    .limit(1);

  if (orderRow.length === 0) return { success: false, error: 'Order not found' };
  const { fileNumber } = orderRow[0]!;

  const awsPath = process.env.AWS_PATH;
  if (!awsPath) return { success: false, error: 'AWS_PATH not configured' };
  const fileUrl = `${awsPath}${doc.storageKey}`;

  const result = await softproUpload({
    orderNumber: fileNumber,
    documentName: doc.filename,
    folderName: doc.category,
    fileUrl,
  });

  if (result.success) {
    await db.update(documents).set({
      isSyncedToSoftpro: true,
      softproSyncedAt: new Date(),
      softproSyncError: null,
      updatedAt: new Date(),
    }).where(eq(documents.id, documentId));

    await db.insert(documentAudit).values({
      documentId,
      action: 'attached_to_softpro',
      meta: { fileNumber, fileUrl, requestId: result.requestId } as Record<string, unknown>,
    });

    return { success: true };
  }

  const errorMessage = result.error?.message ?? 'SoftPro upload failed';

  await db.update(documents).set({
    softproSyncError: errorMessage,
    updatedAt: new Date(),
  }).where(eq(documents.id, documentId));

  await db.insert(documentAudit).values({
    documentId,
    action: 'attach_failed',
    meta: { fileNumber, error: errorMessage, requestId: result.requestId } as Record<string, unknown>,
  });

  return { success: false, error: errorMessage };
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
