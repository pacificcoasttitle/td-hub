import { NextResponse } from 'next/server';
import { getDocumentById } from '@/lib/domain/documents/service';
import { softProDocumentName } from '@/lib/domain/documents/softpro-document-name';
import { verifySoftProFetchToken } from '@/lib/domain/documents/softpro-fetch-token';
import { downloadFile } from '@/lib/integrations/s3/client';

export async function serveSoftProFetchDoc(rawId: string, rawExp: string, sig: string) {
  const documentId = Number(rawId);
  const expUnix = Number(rawExp);

  const verified = verifySoftProFetchToken(documentId, expUnix, sig);
  if (!verified.ok) {
    return NextResponse.json({ error: verified.error }, { status: 401 });
  }

  const doc = await getDocumentById(documentId);
  if (!doc || doc.status === 'deleted') {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  }

  const downloaded = await downloadFile(doc.storageKey);
  if (!downloaded.success || !downloaded.data) {
    return NextResponse.json(
      { error: downloaded.error?.message ?? 'Failed to load document' },
      { status: 502 },
    );
  }

  const filename = softProDocumentName({
    documentId: doc.id,
    category: doc.category,
    filename: doc.filename,
  });

  return new NextResponse(new Uint8Array(downloaded.data), {
    status: 200,
    headers: {
      'Content-Type': doc.contentType ?? 'application/pdf',
      'Content-Length': String(downloaded.data.length),
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
