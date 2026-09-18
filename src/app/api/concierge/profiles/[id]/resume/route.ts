import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { conciergeProfiles, conciergeProfileComps } from '@/lib/db/schema';
import { getSession } from '@/lib/security/auth';
import { canGenerateConcierge } from '@/lib/domain/concierge/access';
import { downloadFile } from '@/lib/integrations/s3/client';
import { ingestPayload } from '@/lib/domain/concierge/generate';
import { renderProfile } from '@/lib/domain/concierge/render';
import { DEFAULT_CRITERIA } from '@/lib/domain/concierge/comp-filter';
import { getProfile } from '@/lib/domain/concierge/profiles';

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

  const [profile] = await db.select().from(conciergeProfiles)
    .where(eq(conciergeProfiles.id, id)).limit(1);
  if (!profile) return NextResponse.json({ error: 'Profile not found.' }, { status: 404 });

  if (!profile.rawStorageKey) {
    return NextResponse.json({
      error: 'This profile has no stored payload, so it cannot be finished without buying it again.',
    }, { status: 409 });
  }

  // Comps already present means the ingest ran. Running it again would double
  // every row; a re-render is what that profile needs, and it is free too.
  const [already] = await db.select({ id: conciergeProfileComps.id })
    .from(conciergeProfileComps).where(eq(conciergeProfileComps.profileId, id)).limit(1);
  if (already) {
    return NextResponse.json({
      error: 'This profile already holds its comparables. Use the re-render instead.',
    }, { status: 409 });
  }

  const raw = await downloadFile(profile.rawStorageKey);
  if (!raw.success || !raw.data) {
    return NextResponse.json({ error: 'The stored payload could not be read.' }, { status: 502 });
  }

  let payload: { Feed?: Record<string, unknown> };
  try {
    payload = JSON.parse(raw.data.toString('utf8')) as { Feed?: Record<string, unknown> };
  } catch {
    return NextResponse.json({ error: 'The stored payload is not readable JSON.' }, { status: 502 });
  }

  const { compsReturned } = await ingestPayload(id, payload);

  const rendered = await renderProfile(id, DEFAULT_CRITERIA);
  if (!rendered.ok) {
    return NextResponse.json({
      error: `${rendered.message} The data is stored, so rendering again costs nothing.`,
      compsReturned,
    }, { status: 409 });
  }

  return NextResponse.json({
    ...await getProfile(id), compsReturned, creditsCharged: 0, resumed: true,
  });
}
