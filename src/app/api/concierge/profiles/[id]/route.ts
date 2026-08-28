import { NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { canGenerateConcierge, canViewConciergeUsage } from '@/lib/domain/concierge/access';
import { getProfile } from '@/lib/domain/concierge/profiles';

export const dynamic = 'force-dynamic';

/** Reading a profile is not gated on the feature flag — an existing document stays viewable. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canGenerateConcierge(session.role) && !canViewConciergeUsage(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  const profile = await getProfile(id);
  if (!profile) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(profile);
}
