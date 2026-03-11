import { db } from '@/lib/db/client';
import { documents, documentAudit } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { uploadFile as s3Upload } from '@/lib/integrations/s3/client';

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
