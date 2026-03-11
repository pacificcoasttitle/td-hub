import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { getDocumentById } from '@/lib/domain/documents/service';
import { getSignedUrl } from '@/lib/integrations/s3/client';
import { db } from '@/lib/db/client';
import { documentAudit } from '@/lib/db/schema';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
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
    if (!doc) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    const urlResult = await getSignedUrl(doc.storageKey);
    if (!urlResult.success) {
      return NextResponse.json(
        { error: urlResult.error?.message ?? 'Failed to generate download URL' },
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

    return NextResponse.redirect(urlResult.data!);
  } catch {
    return NextResponse.json({ error: 'Download failed' }, { status: 500 });
  }
}
