import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { canGenerateConcierge } from '@/lib/domain/concierge/access';
import { requestHazardPreview } from '@/lib/domain/concierge/nhd-bridge';

export const dynamic = 'force-dynamic';
// One vendor round trip plus a PDF render. The tax route takes 120 for the
// same render; this one has no poll loop in front of it.
export const maxDuration = 120;

/**
 * POST — add the MyNHD hazard preview sheet to this profile.
 *
 * ─── NOT A SPENDER, AND ASSERTED NOT TO BE ──────────────────────────────────
 *
 * Gerard, 12 Oct 2026: MyNHD's preview costs PCT nothing. routes.test.ts names
 * exactly two spenders — profiles/route.ts and profiles/[id]/tax/route.ts — and
 * explicitly asserts that THIS route is not one of them. That assertion is the
 * thing that will notice if a future change starts charging here.
 *
 * Nothing in the response is a cost, and `charges` is present and always 0 on
 * purpose: a caller that totals what an action cost should not have to know
 * which vendor it was talking to in order to read the answer.
 *
 * ─── GATED ON THE ROLE, NOT ON THE GENERATE FLAG ────────────────────────────
 *
 * Deliberately different from the tax route, which uses
 * denyConciergeGeneration. That helper refuses when the whole Concierge
 * generate feature is switched off, which is right for a route that spends:
 * turning generation off should stop purchases.
 *
 * This one spends nothing, and it operates on a profile that ALREADY EXISTS.
 * The free routes here — criteria, render, pdf, resume — are deliberately not
 * behind the feature flag, so that switching generation off cannot strand a
 * profile somebody already paid for. A free sheet on an existing profile
 * belongs on that side of the line. The role check stays: this reaches a vendor
 * and writes to a client-facing document.
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canGenerateConcierge(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await ctx.params;
  const profileId = Number(id);
  if (!Number.isInteger(profileId) || profileId <= 0) {
    return NextResponse.json({ error: 'Bad profile id' }, { status: 400 });
  }

  const outcome = await requestHazardPreview(profileId);

  // 200 for a vendor refusal, same as the tax route: the caller asked a
  // question and got a true answer. 409 only for 'refused', which means this
  // profile cannot be asked at all — no payload, no parcel, or a request
  // already in flight.
  return NextResponse.json({
    ok: outcome.ok,
    profileId: outcome.profileId,
    hazardStatus: outcome.status,
    charges: outcome.charges,
    message: outcome.message,
  }, { status: outcome.status === 'refused' ? 409 : 200 });
}
