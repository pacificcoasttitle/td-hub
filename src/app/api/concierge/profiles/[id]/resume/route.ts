import { NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { canGenerateConcierge } from '@/lib/domain/concierge/access';
import { getProfile } from '@/lib/domain/concierge/profiles';
import { resumeFromStored } from '@/lib/domain/concierge/retry';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * POST — finish a profile that was paid for and never completed. FREE.
 *
 * ─── WHAT THIS IS FOR ───────────────────────────────────────────────────────
 *
 * The first real generation (profile 3, 1358 5th St) spent a credit, stored the
 * payload, and then had every comparable row refused by the check constraint
 * because ingest wrote them undecided. Status 'retrieved', no document.
 *
 * Storing the raw response before parsing exists precisely so that state is
 * recoverable: everything after the call is derived, and derived work can be
 * redone for nothing. This route redoes it.
 *
 * ─── IT CANNOT SPEND ────────────────────────────────────────────────────────
 *
 * There is no path from here to the metered endpoint: it does not import the
 * SiteX feed client, and a test asserts generate.ts is its only caller. A
 * profile with no stored payload is REFUSED rather than re-fetched — that is
 * the line between resuming and buying it again.
 *
 * Not gated on the feature flag, for the same reason /render is not: turning
 * generation off must not strand a profile that has already been paid for.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canGenerateConcierge(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  // The work lives in lib/domain/concierge/retry.ts, shared with the Reports
  // list's "Try again". A profile with no stored payload is refused there —
  // the line between resuming and buying it again.
  const r = await resumeFromStored(id);
  if (!r.ok) {
    const status = r.reason === 'not_found' ? 404 : r.reason === 'unreadable' ? 502 : 409;
    return NextResponse.json({ error: r.message }, { status });
  }
  const { compsReturned } = r;

  return NextResponse.json({
    ...await getProfile(id), compsReturned, creditsCharged: 0, resumed: true,
  });
}
