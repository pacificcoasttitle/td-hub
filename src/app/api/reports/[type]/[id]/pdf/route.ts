import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { canGenerateFarming } from '@/lib/domain/reports/access';
import { getFarmingPdf, isFarmingType } from '@/lib/domain/reports/stored';
import { downloadFile } from '@/lib/integrations/s3/client';

export const dynamic = 'force-dynamic';

/**
 * GET — stream a farming report's stored PDF. ?download=1 attaches it.
 *
 * Resolved from the type and id on the server; the browser never names a
 * storage key. Served through our own route, never a public link: legacy put
 * these PDFs at guessable public S3 URLs, and they carry sales data.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ type: string; id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canGenerateFarming(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { type, id: rawId } = await params;
  if (!isFarmingType(type)) return NextResponse.json({ error: 'Unknown report type.' }, { status: 404 });
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  const found = await getFarmingPdf(type, id);
  if (!found.ok) {
    return NextResponse.json({
      error: found.reason === 'not_found' ? 'No such report.'
        : found.status === 'failed' ? 'This report failed to generate, so there is no document.'
          : 'This report has no document yet.',
    }, { status: 404 });
  }

  const file = await downloadFile(found.key);
  if (!file.success || !file.data) {
    return NextResponse.json({ error: 'The document could not be read from storage.' }, { status: 502 });
  }

  const disposition = req.nextUrl.searchParams.get('download') === '1' ? 'attachment' : 'inline';
  return new NextResponse(new Uint8Array(file.data), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(file.data.length),
      'Content-Disposition': `${disposition}; filename="${found.filename}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
