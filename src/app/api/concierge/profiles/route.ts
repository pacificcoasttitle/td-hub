import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { denyConciergeGeneration, denialMessage } from '@/lib/domain/concierge/access';
import { generateConciergeProfile } from '@/lib/domain/concierge/generate';
import { getSpendSnapshot } from '@/lib/domain/concierge/profiles';
import { resolvePresentingRep } from '@/lib/domain/concierge/presenting-rep';

export const dynamic = 'force-dynamic';
// A SiteX call plus a PDF render. Well inside Vercel's ceiling, but not the default.
export const maxDuration = 120;

const bodySchema = z.object({
  // Metadata, never the guard. The entry point is the Reports page, where a
  // request carries no order at all; the double-charge guard is keyed on the
  // property instead (src/lib/domain/concierge/claim.ts).
  orderId: z.number().int().positive().nullable().optional(),
  street: z.string().min(1),
  city: z.string().min(1),
  state: z.string().min(1).default('CA'),
  zip: z.string().min(3),
  preparedForName: z.string().min(1, 'A prepared-for name is required.'),
  preparedForCompany: z.string().optional().nullable(),
  preparedForEmail: z.string().email().optional().nullable(),
  // NOT the rep's details — only which contact to use. The name, email and
  // phone printed on a client-facing document are resolved server-side from
  // the order, never accepted from the browser.
  presentingRepContactId: z.number().int().positive().optional().nullable(),
});

/**
 * POST /api/concierge/profiles — THE ONLY ROUTE THAT SPENDS A CREDIT.
 *
 * Gated on both conditions before anything else happens, so a disabled feature
 * or a wrong role cannot reach the vendor.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const denial = denyConciergeGeneration(session.role);
  if (denial) {
    return NextResponse.json({ error: denialMessage(denial), reason: denial },
      { status: denial === 'feature_off' ? 503 : 403 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 });
  }

  const rep = await resolvePresentingRep(parsed.data.orderId ?? null, parsed.data.presentingRepContactId);
  if (!rep.ok) {
    return NextResponse.json({ error: rep.message, reason: rep.reason }, { status: 400 });
  }

  const result = await generateConciergeProfile({
    ...parsed.data, presentingRep: rep.rep, createdBy: session.email,
  });
  const spend = await getSpendSnapshot();

  if (!result.ok) {
    return NextResponse.json({
      error: result.message, profileId: result.profileId,
      creditsCharged: result.creditsCharged, spend,
    }, { status: 502 });
  }
  return NextResponse.json({ ...result, spend }, { status: 201 });
}
