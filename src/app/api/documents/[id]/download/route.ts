import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { canAccessDocumentOrder } from '@/lib/security/document-access';
import { getDocumentById } from '@/lib/domain/documents/service';
import { getObjectStream } from '@/lib/integrations/s3/client';
import { db } from '@/lib/db/client';
import { documentAudit } from '@/lib/db/schema';

function sanitizeFilename(name: string): string {
  return name.replace(/[\r\n"\\]/g, '_');
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const docId = parseInt(id, 10);
    if (isNaN(docId)) {
      return NextResponse.json({ error: 'Invalid document ID' }, { status: 400 });
    }

    const doc = await getDocumentById(docId);
    if (!doc || doc.status !== 'active') {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    if (!(await canAccessDocumentOrder(session, doc.orderId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const result = await getObjectStream(doc.storageKey);
    if (!result.success || !result.data) {
      return NextResponse.json(
        { error: result.error?.message ?? 'Failed to load document' },
        { status: 502 },
      );
    }

    await db.insert(documentAudit).values({
      documentId: docId,
      action: 'downloaded',
      byUserId: session.id,
      meta: {
        filename: doc.filename,
        storageKey: doc.storageKey,
      } as Record<string, unknown>,
    });

    const filename = sanitizeFilename(doc.filename);
    const contentType = doc.contentType || result.data.contentType || 'application/octet-stream';

    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    };
    if (result.data.contentLength) {
      headers['Content-Length'] = String(result.data.contentLength);
    }

    return new Response(result.data.body, { headers });
  } catch {
    return NextResponse.json({ error: 'Download failed' }, { status: 500 });
  }
}
