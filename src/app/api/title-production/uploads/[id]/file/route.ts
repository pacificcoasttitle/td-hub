import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { titleProductionUploads, vendorApiLogs } from '@/lib/db/schema';
import { getSession } from '@/lib/security/auth';
import { getSignedUrl } from '@/lib/integrations/s3/client';
import { eq } from 'drizzle-orm';

const ALLOWED_ROLES = ['title_production', 'super_admin', 'admin'] as const;

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

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!ALLOWED_ROLES.includes(session.role as (typeof ALLOWED_ROLES)[number])) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const requestId = `title-production-file-${crypto.randomUUID()}`;

  try {
    const { id: rawId } = await params;
    const id = Number(rawId);
    if (Number.isNaN(id) || id <= 0) {
      return NextResponse.json({ error: 'Invalid upload ID' }, { status: 400 });
    }

    const [row] = await db
      .select({
        id: titleProductionUploads.id,
        storageKey: titleProductionUploads.storageKey,
        orderNumber: titleProductionUploads.orderNumber,
        filename: titleProductionUploads.filename,
      })
      .from(titleProductionUploads)
      .where(eq(titleProductionUploads.id, id))
      .limit(1);

    if (!row) {
      return NextResponse.json({ error: 'Upload not found' }, { status: 404 });
    }

    const signedUrlResult = await getSignedUrl(row.storageKey, 5 * 60);
    if (!signedUrlResult.success) {
      const message = signedUrlResult.error?.message ?? 'Failed to generate file URL';
      await logRouteEvent({
        requestId,
        operation: 'proxy_redirect_failed',
        success: false,
        httpStatus: 500,
        errorCategory: 'S3_PRESIGN',
        requestMeta: { uploadId: row.id, orderNumber: row.orderNumber, filename: row.filename, storageKey: row.storageKey },
        responseMeta: { error: message },
      });
      return NextResponse.json({ error: message }, { status: 500 });
    }

    await logRouteEvent({
      requestId,
      operation: 'proxy_redirect',
      success: true,
      httpStatus: 302,
      requestMeta: { uploadId: row.id, orderNumber: row.orderNumber, filename: row.filename, storageKey: row.storageKey },
    });

    return NextResponse.redirect(signedUrlResult.data!, { status: 302 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'File redirect failed';
    await logRouteEvent({
      requestId,
      operation: 'proxy_request_failed',
      success: false,
      httpStatus: 500,
      errorCategory: 'REQUEST_ERROR',
      responseMeta: { error: message },
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
