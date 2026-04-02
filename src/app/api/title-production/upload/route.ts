import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { titleProductionUploads, vendorApiLogs } from '@/lib/db/schema';
import { getSession } from '@/lib/security/auth';
import { uploadFile, getSignedUrl } from '@/lib/integrations/s3/client';
import { uploadDocument as softproUpload } from '@/lib/integrations/softpro/client';
import { desc, eq } from 'drizzle-orm';

const ALLOWED_ROLES = ['title_production', 'super_admin', 'admin'] as const;

function sanitizeDocumentName(input: string): string {
  const sanitized = input
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9_-]/g, '');

  return sanitized || 'document';
}

function isPdfFile(file: File): boolean {
  const lowerName = file.name.toLowerCase();
  const contentType = (file.type || '').toLowerCase();
  return lowerName.endsWith('.pdf') && contentType === 'application/pdf';
}

function getAppUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!configured) return 'https://td-hub.vercel.app';
  return configured.replace(/\/$/, '');
}

async function logRouteEvent(params: {
  requestId: string;
  operation: string;
  success: boolean;
  httpStatus?: number;
  errorCategory?: string;
  requestMeta?: Record<string, unknown>;
  responseMeta?: Record<string, unknown>;
}) {
  try {
    await db.insert(vendorApiLogs).values({
      vendor: 'title_production',
      operation: params.operation,
      requestId: params.requestId,
      startedAt: new Date(),
      endedAt: new Date(),
      success: params.success,
      httpStatus: params.httpStatus ?? null,
      errorCategory: params.errorCategory ?? null,
      requestMeta: params.requestMeta ?? null,
      responseMeta: params.responseMeta ?? null,
    });
  } catch {
    // Best-effort logging only.
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!ALLOWED_ROLES.includes(session.role as (typeof ALLOWED_ROLES)[number])) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const requestId = `title-production-upload-${crypto.randomUUID()}`;

  try {
    const formData = await req.formData();
    const orderNumber = String(formData.get('orderNumber') ?? '').trim();
    const documentName = String(formData.get('documentName') ?? '').trim();
    const files = formData.getAll('files').filter((value): value is File => value instanceof File);

    await logRouteEvent({
      requestId,
      operation: 'upload_request',
      success: true,
      requestMeta: {
        orderNumber,
        documentName,
        fileCount: files.length,
        filenames: files.map((file) => file.name),
      },
    });

    if (!orderNumber) {
      return NextResponse.json({ error: 'orderNumber is required' }, { status: 400 });
    }

    if (!documentName) {
      return NextResponse.json({ error: 'documentName is required' }, { status: 400 });
    }

    if (files.length === 0) {
      return NextResponse.json({ error: 'At least one file is required' }, { status: 400 });
    }

    const invalidFiles = files.filter((file) => !isPdfFile(file)).map((file) => file.name);
    if (invalidFiles.length > 0) {
      await logRouteEvent({
        requestId,
        operation: 'upload_validation_failed',
        success: false,
        httpStatus: 400,
        errorCategory: 'INVALID_FILE_TYPE',
        requestMeta: { orderNumber, documentName, filenames: files.map((file) => file.name) },
        responseMeta: { invalidFiles },
      });
      return NextResponse.json({
        error: 'All files must be PDFs with application/pdf content type',
        invalidFiles,
      }, { status: 400 });
    }

    const sanitizedDocumentName = sanitizeDocumentName(documentName);
    const results: Array<{ filename: string; publicUrl: string; synced: boolean; syncError?: string }> = [];

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index]!;
      const timestamp = Date.now() + index;
      const filename = `${sanitizedDocumentName}_${timestamp}.pdf`;
      const storageKey = `desk-file-upload/${filename}`;

      try {
        const buffer = Buffer.from(await file.arrayBuffer());

        const uploadResult = await uploadFile({
          key: storageKey,
          buffer,
          contentType: 'application/pdf',
        });

        if (!uploadResult.success) {
          const syncError = uploadResult.error?.message ?? 'S3 upload failed';
          results.push({ filename, publicUrl: '', synced: false, syncError });

          await logRouteEvent({
            requestId,
            operation: 'file_upload_failed',
            success: false,
            errorCategory: 'S3_UPLOAD',
            requestMeta: { orderNumber, documentName, filename, storageKey },
            responseMeta: { error: syncError },
          });
          continue;
        }

        const [uploadRow] = await db
          .insert(titleProductionUploads)
          .values({
            orderNumber,
            documentName,
            filename,
            storageKey,
            publicUrl: null,
            uploadedBy: session.id,
          })
          .returning({ id: titleProductionUploads.id });

        const permanentUrl = `${getAppUrl()}/api/title-production/uploads/${uploadRow!.id}/file`;

        await db
          .update(titleProductionUploads)
          .set({ publicUrl: permanentUrl })
          .where(eq(titleProductionUploads.id, uploadRow!.id));

        const signedUrlResult = await getSignedUrl(storageKey, 24 * 60 * 60);
        if (!signedUrlResult.success) {
          const syncError = signedUrlResult.error?.message ?? 'Failed to generate S3 signed URL';
          await db
            .update(titleProductionUploads)
            .set({
              isSynced: false,
              syncReason: syncError,
            })
            .where(eq(titleProductionUploads.id, uploadRow!.id));

          results.push({ filename, publicUrl: permanentUrl, synced: false, syncError });

          await logRouteEvent({
            requestId,
            operation: 'signed_url_failed',
            success: false,
            errorCategory: 'S3_PRESIGN',
            requestMeta: { orderNumber, documentName, filename, storageKey, uploadRowId: uploadRow!.id },
            responseMeta: { error: syncError },
          });
          continue;
        }

        const softproFileUrl = signedUrlResult.data!;

        const softproResult = await softproUpload({
          documentId: uploadRow!.id,
          orderNumber,
          documentName,
          folderName: 'desk-file-upload',
          fileUrl: softproFileUrl,
        });

        let vendorLogId: number | null = null;
        if (softproResult.requestId) {
          const [logRow] = await db
            .select({ id: vendorApiLogs.id })
            .from(vendorApiLogs)
            .where(eq(vendorApiLogs.requestId, softproResult.requestId))
            .orderBy(desc(vendorApiLogs.createdAt))
            .limit(1);
          vendorLogId = logRow?.id ?? null;
        }

        if (softproResult.success) {
          await db
            .update(titleProductionUploads)
            .set({
              isSynced: true,
              syncReason: null,
              vendorLogId,
            })
            .where(eq(titleProductionUploads.id, uploadRow!.id));

          results.push({ filename, publicUrl: permanentUrl, synced: true });

          await logRouteEvent({
            requestId,
            operation: 'file_uploaded',
            success: true,
            requestMeta: { orderNumber, documentName, filename, storageKey, uploadRowId: uploadRow!.id },
            responseMeta: { publicUrl: permanentUrl, synced: true, vendorLogId },
          });
          continue;
        }

        const syncError = softproResult.error?.message ?? 'Unknown SoftPro error';
        await db
          .update(titleProductionUploads)
          .set({
            isSynced: false,
            syncReason: syncError,
            vendorLogId,
          })
          .where(eq(titleProductionUploads.id, uploadRow!.id));

        results.push({ filename, publicUrl: permanentUrl, synced: false, syncError });

        await logRouteEvent({
          requestId,
          operation: 'softpro_sync_failed',
          success: false,
          errorCategory: 'SOFTPRO_UPLOAD',
          requestMeta: { orderNumber, documentName, filename, storageKey, uploadRowId: uploadRow!.id },
          responseMeta: { publicUrl: permanentUrl, syncError, vendorLogId, softproRequestId: softproResult.requestId },
        });
      } catch (err) {
        const syncError = err instanceof Error ? err.message : 'Upload failed';
        results.push({ filename, publicUrl: '', synced: false, syncError });

        await logRouteEvent({
          requestId,
          operation: 'file_processing_failed',
          success: false,
          errorCategory: 'UPLOAD_ERROR',
          requestMeta: { orderNumber, documentName, filename, storageKey },
          responseMeta: { error: syncError },
        });
      }
    }

    await logRouteEvent({
      requestId,
      operation: 'upload_complete',
      success: true,
      httpStatus: 200,
      requestMeta: { orderNumber, documentName, fileCount: files.length },
      responseMeta: { results },
    });

    return NextResponse.json({
      success: true,
      results,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upload failed';

    await logRouteEvent({
      requestId,
      operation: 'upload_request_failed',
      success: false,
      httpStatus: 500,
      errorCategory: 'REQUEST_ERROR',
      responseMeta: { error: message },
    });

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
