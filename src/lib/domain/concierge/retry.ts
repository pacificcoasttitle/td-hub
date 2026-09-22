/**
 * Finishing, or re-finishing, a profile from what is already stored. FREE.
 *
 * Two routes use this: POST /api/concierge/profiles/[id]/resume, which finishes
 * a profile whose ingest never completed, and the Reports list's "Try again",
 * which does whichever of the two a failed profile needs.
 *
 * ─── IT CANNOT SPEND ────────────────────────────────────────────────────────
 *
 * Nothing here imports the SiteX client. A profile with no stored payload is
 * REFUSED rather than re-fetched — that refusal is the line between retrying
 * and buying the same property twice.
 */
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { conciergeProfiles, conciergeProfileComps } from '@/lib/db/schema';
import { downloadFile } from '@/lib/integrations/s3/client';
import { ingestPayload } from './generate';
import { renderProfile } from './render';
import { DEFAULT_CRITERIA } from './comp-filter';

export const NO_PAYLOAD_MESSAGE =
  'This profile has no stored payload, so it cannot be finished without buying it again.';

export type ResumeOutcome =
  | { ok: true; compsReturned: number }
  | { ok: false; reason: 'not_found' | 'no_payload' | 'has_comps' | 'unreadable' | 'render'; message: string };

/**
 * Ingest the stored payload and render. Refuses a profile that already holds
 * its comparables — running ingest again would double every row; what that one
 * needs is a re-render, which is also free.
 */
export async function resumeFromStored(id: number): Promise<ResumeOutcome> {
  const [profile] = await db.select().from(conciergeProfiles).where(eq(conciergeProfiles.id, id)).limit(1);
  if (!profile) return { ok: false, reason: 'not_found', message: 'Profile not found.' };
  if (!profile.rawStorageKey) return { ok: false, reason: 'no_payload', message: NO_PAYLOAD_MESSAGE };

  const [already] = await db.select({ id: conciergeProfileComps.id })
    .from(conciergeProfileComps).where(eq(conciergeProfileComps.profileId, id)).limit(1);
  if (already) {
    return { ok: false, reason: 'has_comps', message: 'This profile already holds its comparables. Use the re-render instead.' };
  }

  const raw = await downloadFile(profile.rawStorageKey);
  if (!raw.success || !raw.data) return { ok: false, reason: 'unreadable', message: 'The stored payload could not be read.' };

  let payload: { Feed?: Record<string, unknown> };
  try {
    payload = JSON.parse(raw.data.toString('utf8')) as { Feed?: Record<string, unknown> };
  } catch {
    return { ok: false, reason: 'unreadable', message: 'The stored payload is not readable JSON.' };
  }

  const { compsReturned } = await ingestPayload(id, payload);
  const rendered = await renderProfile(id, DEFAULT_CRITERIA);
  if (!rendered.ok) {
    return { ok: false, reason: 'render', message: `${rendered.message} The data is stored, so rendering again costs nothing.` };
  }
  return { ok: true, compsReturned };
}

/**
 * "Try again" for a failed profile: finish it if the ingest never ran,
 * re-render it if it did. Never a new call to the vendor.
 */
export async function retryProfile(id: number): Promise<
  { ok: true; mode: 'resumed' | 'rerendered' } | { ok: false; reason: string; message: string }
> {
  const resumed = await resumeFromStored(id);
  if (resumed.ok) return { ok: true, mode: 'resumed' };
  if (resumed.reason !== 'has_comps') return resumed;

  const rendered = await renderProfile(id);
  if (!rendered.ok) return { ok: false, reason: 'render', message: `${rendered.message} Rendering again costs nothing.` };
  return { ok: true, mode: 'rerendered' };
}
