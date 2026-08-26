import { NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { canGenerateConcierge } from '@/lib/domain/concierge/access';
import { renderProfile } from '@/lib/domain/concierge/render';
import { getProfile } from '@/lib/domain/concierge/profiles';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST — re-render with the criteria already stored. FREE.
 *
 * This is the retry after a render failed on data we successfully retrieved and
 * paid for. It is a DISTINCT route from generation on purpose: nothing here can
 * be confused with spending, and renderProfile refuses a profile that has no
 * stored payload, so a retry can never become a second call.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canGenerateConcierge(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  const result = await renderProfile(id);
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: 409 });
  return NextResponse.json({ ...await getProfile(id), creditsCharged: 0, freeRender: true });
}
