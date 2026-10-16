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

/**
 * How long a paid-for resolution may be finalised without buying it again.
 *
 * ─── WHY IT EXPIRES AT ALL ──────────────────────────────────────────────────
 *
 * A resolution is a payload with a timestamp: assessed values, comparables and
 * transfer history as they stood when the credit was spent. Finalising it next
 * month would print month-old data under today's date, which is worse than
 * paying again. So it expires, and the expiry is short enough that the
 * document is from the day the property was looked up.
 *
 * ─── WHY A DAY, AND NOT FIFTEEN MINUTES ─────────────────────────────────────
 *
 * The claim's fifteen minutes defeat a double-click. This window has a
 * different job: an operator resolves an address, gets pulled onto a closing,
 * and comes back after lunch to fill in the prepared-for name. Fifteen minutes
 * would charge them twice for that. A day covers the interruption without
 * letting the payload go stale.
 *
 * `findProfileForProperty` above still covers the longer horizon — it finds a
 * GENERATED profile over all time and offers it.
 */
export const RESOLUTION_TTL_MS = 24 * 60 * 60 * 1000;

export interface ResolvedProfile {
  id: number;
  createdAt: string;
  /** Whole minutes since the credit was spent. */
  ageMinutes: number;
  rawStorageKey: string;
}

/**
 * A resolution already paid for and not yet turned into a document.
 *
 * This is the second operator's answer to "has this already been bought?" in
 * the window where the first operator has spent the credit but not yet filled
 * in the gate. Without it, two people resolving the same property five minutes
 * apart buy it twice — the claim has nothing to say, because the first
 * operator's claim was released the moment their lookup succeeded.
 *
 * Requires the stored payload, not merely the status: a 'retrieved' row whose
 * upload failed has nothing to finalise FROM, and offering it would strand the
 * second operator on a row that can never produce a document.
 */
export async function findResolvedForProperty(
  propertyKey: string,
  now: Date = new Date(),
): Promise<ResolvedProfile | null> {
  if (!propertyKey) return null;

  const [row] = await db.select({
    id: conciergeProfiles.id,
    createdAt: conciergeProfiles.createdAt,
    rawStorageKey: conciergeProfiles.rawStorageKey,
  })
    .from(conciergeProfiles)
    .where(and(
      eq(conciergeProfiles.propertyKey, propertyKey),
      eq(conciergeProfiles.status, 'retrieved'),
      isNotNull(conciergeProfiles.rawStorageKey),
    ))
    .orderBy(desc(conciergeProfiles.createdAt))
    .limit(1);

  if (!row?.rawStorageKey) return null;

  const created = new Date(row.createdAt);
  const age = now.getTime() - created.getTime();
  // Expired is the same as absent: the caller resolves afresh and pays.
  if (age > RESOLUTION_TTL_MS || age < 0) return null;

  return {
    id: row.id,
    createdAt: created.toISOString(),
    ageMinutes: Math.max(0, Math.floor(age / 60_000)),
    rawStorageKey: row.rawStorageKey,
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
  // The duplicate guard is the thing that actually prevents a second lookup,
  // so this sentence carries the weight the credit wording used to: it names
  // the property, the date and the age, and offers the cheap way out first.
  return `A profile for this property was generated on ${when} (${age}). `
    + 'Open it, or generate a fresh one — that is a second property lookup.';
}
