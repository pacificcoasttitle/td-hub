/**
 * "We already have this property."
 *
 * ─── WHY THIS IS NOT THE CLAIM ──────────────────────────────────────────────
 *
 * The claim (claim.ts) expires after fifteen minutes, and should: it exists to
 * defeat a double-click and an impatient second operator, and a genuine re-run
 * next quarter must still work, because comparables move.
 *
 * That left fifteen minutes as the ONLY thing between us and paying twice for
 * one property. At 3:16pm the same address buys a second profile at full price,
 * and nothing is said. This answers the other question — not "is someone
 * spending on this right now" but "did we already buy this" — over all time,
 * from the profile rows themselves (migration 0059).
 *
 * ─── IT INFORMS, IT DOES NOT BLOCK ──────────────────────────────────────────
 *
 * A six-month-old profile may legitimately need refreshing; a same-week one
 * almost never does. So the operator is told what exists and when, and chooses.
 * Refusing outright would be wrong, and silently spending is what we are here
 * to stop.
 *
 * The check is a READ, deliberately racy — two clicks a second apart both see
 * nothing and both proceed. That race is the claim's job, and the claim still
 * runs after this. Belt and braces, in that order.
 */
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { conciergeProfiles } from '@/lib/db/schema';

export interface ExistingProfile {
  id: number;
  /** ISO, as stored. */
  createdAt: string;
  /** Whole days between then and now, for the sentence the operator reads. */
  ageDays: number;
  preparedForName: string | null;
  presentingRepName: string | null;
  hasPdf: boolean;
}

/**
 * Only a GENERATED profile counts. A failed one has nothing to open, and a
 * pending one is either in flight — which the claim covers — or abandoned; in
 * both cases telling someone "we already have this" would be a lie.
 */
export async function findProfileForProperty(
  propertyKey: string,
  now: Date = new Date(),
): Promise<ExistingProfile | null> {
  if (!propertyKey) return null;

  const [row] = await db.select({
    id: conciergeProfiles.id,
    createdAt: conciergeProfiles.createdAt,
    preparedForName: conciergeProfiles.preparedForName,
    presentingRepName: conciergeProfiles.presentingRepName,
    pdfStorageKey: conciergeProfiles.pdfStorageKey,
  })
    .from(conciergeProfiles)
    .where(and(
      eq(conciergeProfiles.propertyKey, propertyKey),
      eq(conciergeProfiles.status, 'generated'),
      isNotNull(conciergeProfiles.pdfStorageKey),
    ))
    .orderBy(desc(conciergeProfiles.createdAt))
    .limit(1);

  if (!row) return null;

  const created = new Date(row.createdAt);
  const ageDays = Math.max(0, Math.floor((now.getTime() - created.getTime()) / 86_400_000));

  return {
    id: row.id,
    createdAt: created.toISOString(),
    ageDays,
    preparedForName: row.preparedForName,
    presentingRepName: row.presentingRepName,
    hasPdf: true,
  };
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * The sentence the operator reads before deciding. Says WHEN in full — the age
 * is the whole basis of the judgement they are being asked to make.
 */
export function alreadyHaveMessage(existing: ExistingProfile): string {
  const d = new Date(existing.createdAt);
  const when = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  const age = existing.ageDays === 0 ? 'today'
    : existing.ageDays === 1 ? 'yesterday'
      : `${existing.ageDays} days ago`;
  return `A profile for this property was generated on ${when} (${age}). `
    + 'Open it, or generate a fresh one for 1 credit.';
}
