import { NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { canGenerateConcierge, canViewConciergeUsage } from '@/lib/domain/concierge/access';
import { getProfileForOrder } from '@/lib/domain/concierge/profiles';
import { resolvePresentingRep } from '@/lib/domain/concierge/presenting-rep';

export const dynamic = 'force-dynamic';

/**
 * The Documents tile asks this before deciding what to offer.
 *
 * A FAILED profile is returned too, deliberately: the tile must be able to say
 * "this failed, and why". A tile that shows nothing after a spent credit invites
 * a second click and a second credit.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canGenerateConcierge(session.role) && !canViewConciergeUsage(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const orderId = Number((await params).id);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return NextResponse.json({ error: 'Bad id' }, { status: 400 });
  }
  // The gate shows the rep BEFORE the spend, resolved the same way generation
  // will resolve it — so what the operator reads is what the document will say.
  const rep = await resolvePresentingRep(orderId);
  return NextResponse.json({
    profile: await getProfileForOrder(orderId),
    presentingRep: rep.ok ? rep.rep : null,
    presentingRepProblem: rep.ok ? null : rep.message,
  });
}
