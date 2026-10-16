import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { denyConciergeGeneration, denialMessage } from '@/lib/domain/concierge/access';
import { resolveProperty } from '@/lib/domain/concierge/generate';
import { getSpendSnapshot } from '@/lib/domain/concierge/profiles';

export const dynamic = 'force-dynamic';
// One SiteX call. No render, so nowhere near the generate route's ceiling.
export const maxDuration = 60;

/**
 * POST /api/concierge/resolve — WHICH PROPERTY IS THIS? One credit.
 *
 * ─── WHY THE SPEND MOVED HERE ───────────────────────────────────────────────
 *
 * The gate used to come first: an operator typed a prepared-for name, a rep,
 * criteria and add-ons, clicked Generate, and only then found out the address
 * matched four parcels — after being charged. Picking a parcel re-sent the
 * whole form and charged again, so a condominium cost two credits and a
 * quarter of an hour.
 *
 * So the question that costs money is now asked first, on its own, with
 * nothing filled in: the address step IS the lookup. What comes back is a
 * resolution — a profile row holding the paid-for payload with no document.
 * Everything after it is free, which is what makes the gate safe to get wrong.
 *
 * ─── WHAT IS FREE HERE ──────────────────────────────────────────────────────
 *
 * A 300 (more than one parcel at that address) and a 404 (no such address)
 * both charge NOTHING. The 300 comes back as a list to choose from and the
 * chosen parcel is resolved by APN — which is the call that charges. One
 * credit total for a condominium, where it used to be two.
 *
 * A resolution already paid for within the window is returned as-is, for
 * nothing. That is deliberately not keyed on who asked: two operators working
 * the same property minutes apart share the one credit.
 */
const bodySchema = z.object({
  // Metadata, never the guard. The Reports entry point carries no order at all;
  // the double-charge guard is keyed on the property instead (claim.ts).
  orderId: z.number().int().positive().nullable().optional(),
  street: z.string().min(1),
  city: z.string().min(1),
  state: z.string().min(1).default('CA'),
  /**
   * Optional, because a parcel search has no postal address. Validated when
   * present — a two-character ZIP was always a typo — and the modal requires
   * it in address mode, where its absence IS an error. A fabricated ZIP on the
   * row would be a claim about the property.
   */
  zip: z.string().min(3).optional().or(z.literal('')),
  /**
   * The parcel chosen out of a multi-match.
   *
   * Accepted from the browser, unlike the rep's details, because it is not
   * printed on the document as fact — it selects which property to ask SiteX
   * about, and SiteX's answer still goes through the full guard. `requested_apn`
   * records what we sent, so what we asked for and what came back stay
   * comparable.
   *
   * Both or neither: `apn` without a FIPS is the request shape that failed
   * every time in the orders flow, so the feed client declines to send it.
   */
  apn: z.string().trim().min(1).max(50).optional().nullable(),
  fips: z.string().trim().regex(/^\d{5}$/, 'FIPS must be five digits.').optional().nullable(),
  /**
   * Set only after the operator has been shown what we already hold and asked
   * for a fresh lookup. Skips the reuse of an existing resolution too: someone
   * who asked for a fresh call should get one, not this morning's payload.
   */
  allowDuplicate: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // BOTH conditions before anything else, so a disabled feature or a wrong
  // role cannot reach the vendor — and before the body parse, so it cannot
  // reach validation either.
  const denial = denyConciergeGeneration(session.role);
  if (denial) {
    return NextResponse.json({ error: denialMessage(denial), reason: denial },
      { status: denial === 'feature_off' ? 503 : 403 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 });
  }

  // NO presenting rep, no prepared-for name. Resolve does not know them and
  // does not need them: nothing it writes appears on a document.
  const result = await resolveProperty({ ...parsed.data, createdBy: session.email });

  // We already hold a finished profile and nobody said to buy it again. 409,
  // not 502 — a choice to make rather than a failure.
  if (!result.ok && 'alreadyHave' in result) {
    return NextResponse.json({
      error: result.message, reason: 'already_have',
      existing: result.alreadyHave, profileId: result.profileId, creditsCharged: 0,
    }, { status: 409 });
  }

  const spend = await getSpendSnapshot();

  if (!result.ok) {
    // THE CANDIDATES TRAVEL WITH THE REFUSAL. A multi-match is a question, and
    // 409 says so: the operator has a choice and nothing was charged. The same
    // shape as `already_have`, and nothing like the 502 that covers real
    // failures.
    const candidates = 'candidates' in result ? result.candidates : undefined;
    if (candidates && candidates.length > 0) {
      return NextResponse.json({
        error: result.message, reason: 'ambiguous_match', candidates,
        profileId: result.profileId, creditsCharged: result.creditsCharged, spend,
      }, { status: 409 });
    }
    if ('duplicate' in result) {
      return NextResponse.json({
        error: result.message, reason: 'duplicate',
        profileId: result.profileId, creditsCharged: 0, spend,
      }, { status: 409 });
    }
    return NextResponse.json({
      error: result.message, profileId: result.profileId,
      creditsCharged: result.creditsCharged, spend,
    }, { status: 502 });
  }

  // 200, not 201: the resolution may be one we already had, and `reused` says
  // which. The operator is told either way — a free reuse is good news, and
  // hiding it would make the credit count look wrong.
  return NextResponse.json({ ...result.resolved, spend }, { status: 200 });
}
