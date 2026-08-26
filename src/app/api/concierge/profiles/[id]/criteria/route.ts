import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { canGenerateConcierge } from '@/lib/domain/concierge/access';
import { renderProfile } from '@/lib/domain/concierge/render';
import { getProfile } from '@/lib/domain/concierge/profiles';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// The six controls, bounded so a slider cannot ask for something meaningless.
// null means "do not apply this filter at all", which is different from 0.
const criteriaSchema = z.object({
  sameUseCode: z.boolean(),
  livingAreaPct: z.number().int().min(0).max(500).nullable(),
  bedDelta: z.number().int().min(0).max(10).nullable(),
  bathDelta: z.number().int().min(0).max(10).nullable(),
  radiusMiles: z.number().min(0).max(50).nullable(),
  months: z.number().int().min(1).max(120).nullable(),
  maxComps: z.number().int().min(1).max(50),
});

/**
 * PATCH — re-filter stored comparables and re-render.
 *
 * FREE, ALWAYS. renderProfile cannot reach SiteX; see render.ts and its test.
 * The operator can move a slider as often as they like: the comparables were
 * bought once and the criteria are ours.
 *
 * NOT gated on the feature flag. Turning generation off must not strand a
 * profile that already exists — the operator can still adjust and re-render it.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canGenerateConcierge(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  const parsed = criteriaSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid criteria' }, { status: 400 });
  }

  const result = await renderProfile(id, parsed.data);
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: 409 });

  return NextResponse.json({ ...await getProfile(id), creditsCharged: 0, freeRender: true });
}
