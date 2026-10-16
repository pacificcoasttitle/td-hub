import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { canGenerateConcierge } from '@/lib/domain/concierge/access';
import { finaliseProfile } from '@/lib/domain/concierge/generate';
import { getProfile } from '@/lib/domain/concierge/profiles';
import { resolvePresentingRep } from '@/lib/domain/concierge/presenting-rep';

export const dynamic = 'force-dynamic';
// A PDF render, no vendor call.
export const maxDuration = 120;

/**
 * POST /api/concierge/profiles/[id]/finalise — turn a resolution into a
 * document. FREE.
 *
 * ─── IT CANNOT SPEND ────────────────────────────────────────────────────────
 *
 * There is no path from here to the metered endpoint: it does not import the
 * SiteX feed client, and `finaliseProfile` refuses a profile with no stored
 * payload rather than going to get one. That refusal is the line between
 * finishing and buying it again.
 *
 * ─── GENERATE RENDERS, IT DOES NOT LOOK UP ──────────────────────────────────
 *
 * This is the second half of the resolve-first flow (Gerard, 16 Oct 2026). The
 * property was identified and paid for by /api/concierge/resolve; everything
 * collected here — prepared-for name, rep, criteria — is free, so getting it
 * wrong costs a re-render and not a credit.
 *
 * Not gated on the feature flag, for the same reason /render and /resume are
 * not: turning generation off must not strand a property already paid for.
 */
const bodySchema = z.object({
  preparedForName: z.string().min(1, 'A prepared-for name is required.'),
  preparedForCompany: z.string().optional().nullable(),
  preparedForEmail: z.string().email().optional().nullable(),
  // NOT the rep's details — only which contact to use. The name, email and
  // phone printed on a client-facing document are resolved server-side from
  // the order, never accepted from the browser.
  presentingRepContactId: z.number().int().positive().optional().nullable(),
  orderId: z.number().int().positive().nullable().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canGenerateConcierge(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 });
  }

  const rep = await resolvePresentingRep(parsed.data.orderId ?? null, parsed.data.presentingRepContactId);
  if (!rep.ok) {
    return NextResponse.json({ error: rep.message, reason: rep.reason }, { status: 400 });
  }

  const result = await finaliseProfile(id, { ...parsed.data, presentingRep: rep.rep });

  if (!result.ok) {
    // Already a document: the second operator in the window, or a double-click.
    // 409 and the profile, not a red box — there is nothing to fix.
    if (result.alreadyGenerated) {
      return NextResponse.json({
        error: result.message, reason: 'already_generated',
        ...await getProfile(id), creditsCharged: 0,
      }, { status: 409 });
    }
    return NextResponse.json({ error: result.message, profileId: id, creditsCharged: 0 }, { status: 502 });
  }

  return NextResponse.json({
    ...await getProfile(id),
    compsShown: result.compsShown,
    // Said plainly, because the whole point of the split is that this half is
    // free and the operator should know it.
    creditsCharged: 0,
  }, { status: 201 });
}
