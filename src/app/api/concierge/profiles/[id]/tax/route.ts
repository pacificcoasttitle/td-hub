import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { denyConciergeGeneration, denialMessage } from '@/lib/domain/concierge/access';
import { requestTaxDetail } from '@/lib/domain/concierge/tax-bridge';

export const dynamic = 'force-dynamic';

/**
 * POST — buy the TitlePoint tax detail for this profile, or finish one already
 * bought.
 *
 * ─── THE SECOND SPENDER ─────────────────────────────────────────────────────
 *
 * This is the only route other than profiles/route.ts that can cost money, and
 * routes.test.ts names both of them explicitly. That assertion was written when
 * there was exactly one; it has been changed to say TWO rather than loosened to
 * stop caring, because a guard relaxed to accommodate a change stops being a
 * guard.
 *
 * It spends on TITLEPOINT ONLY. It never touches the SiteX path, the generator,
 * or sitex_credits_charged — we have already paid for this property once and
 * re-running generate would buy it twice. That is also why the charge is
 * recorded in its own column: a blended figure reconciles against neither
 * vendor's invoice.
 *
 * ─── GATED LIKE THE GENERATE, NOT LIKE THE FREE ROUTES ──────────────────────
 *
 * denyConciergeGeneration, before anything else. The free routes
 * (criteria / render / pdf / resume) deliberately are NOT gated on the feature
 * flag, so that turning generation off cannot strand a profile that already
 * exists. This one spends, so it belongs on the other side of that line.
 *
 * ─── IT RETURNS BEFORE THE SEARCH FINISHES ──────────────────────────────────
 *
 * TitlePoint tax is create → poll → fetch and takes minutes. Holding the request
 * open would reproduce the charged-but-incomplete failure `resume` exists for.
 * So this answers as soon as the spend is decided, and the profile re-renders
 * itself for free when the result lands.
 *
 * Calling it again on a pending profile FINISHES, and charges nothing.
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Same shape as the generate route: a disabled feature is 503 and not the
  // operator's fault, a role refusal is 403.
  const denial = denyConciergeGeneration(session.role);
  if (denial) {
    return NextResponse.json({ error: denialMessage(denial), reason: denial },
      { status: denial === 'feature_off' ? 503 : 403 });
  }

  const { id } = await ctx.params;
  const profileId = Number(id);
  if (!Number.isInteger(profileId) || profileId <= 0) {
    return NextResponse.json({ error: 'Bad profile id' }, { status: 400 });
  }

  const outcome = await requestTaxDetail(profileId);

  // 200 even for a denied county or an already-running search: the caller asked
  // a question and got a true answer, and nothing failed. What the operator
  // needs to know is the status and the cost, both of which are in the body.
  return NextResponse.json({
    ok: outcome.ok,
    profileId: outcome.profileId,
    taxStatus: outcome.status,
    // Named for its vendor. `creditsCharged` on this route would read as SiteX
    // and land in the wrong column in somebody's head.
    titlePointCharges: outcome.titlePointCharges,
    requestId: outcome.requestId,
    message: outcome.message,
  }, { status: outcome.status === 'refused' ? 409 : 200 });
}
