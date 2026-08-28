import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { canGenerateConcierge, canViewConciergeUsage } from '@/lib/domain/concierge/access';
import { getProfile, getProfilePdfKey } from '@/lib/domain/concierge/profiles';
import { downloadFile } from '@/lib/integrations/s3/client';

export const dynamic = 'force-dynamic';

/**
 * GET — stream the stored PDF. ?download=1 attaches rather than inlines.
 *
 * The file is resolved from the profile id server-side. No storage key or URL
 * is ever accepted from the browser — that is the shape of the legacy delivery
 * defect, where the page posted an S3 URL and the server obliged.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canGenerateConcierge(session.role) && !canViewConciergeUsage(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  const key = await getProfilePdfKey(id);
  if (!key) return NextResponse.json({ error: 'This profile has no document.' }, { status: 404 });

  const file = await downloadFile(key);
  if (!file.success || !file.data) {
    return NextResponse.json({ error: 'The document could not be read from storage.' }, { status: 502 });
  }

  const profile = await getProfile(id);
  const slug = (profile?.requestedAddress ?? 'property-profile')
    .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'property-profile';
  const disposition = req.nextUrl.searchParams.get('download') === '1' ? 'attachment' : 'inline';

  return new NextResponse(new Uint8Array(file.data), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(file.data.length),
      'Content-Disposition': `${disposition}; filename="${slug}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
