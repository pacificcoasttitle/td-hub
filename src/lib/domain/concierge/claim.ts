/**
 * The double-charge guard. One SiteX credit per property per window.
 *
 * ─── WHAT IT REPLACES ───────────────────────────────────────────────────────
 *
 * "One profile per order": the route looked the order up and refused with 409.
 * The entry point is moving off the order to the Reports page, where a request
 * carries no order — so that guard protected nothing there, and two clicks were
 * two credits. `orderId` is metadata now, never the guard.
 *
 * ─── WHAT IT KEYS ON, AND WHY NOT THE APN ───────────────────────────────────
 *
 * There is no free address-resolution step. `fetchConciergeProfile` makes ONE
 * SiteX call which both resolves the address and returns the data — a 2xx costs
 * a credit — so the APN, the location count and the SearchId all arrive FROM
 * the spend. Nothing derived from resolution exists before the money is gone.
 *
 * So the claim is taken on the NORMALIZED REQUESTED ADDRESS, before the call.
 * The APN is written onto the claim afterwards, which is what makes a second
 * request for the same property visible even when the address was typed
 * differently — as evidence, not as the pre-spend key, because it cannot be.
 *
 * ─── WHY A CLAIM AND NOT A LOOKUP ───────────────────────────────────────────
 *
 * A read-then-write ("is there a recent profile? no? generate") loses the race
 * a double-click creates: both requests read nothing and both spend. The claim
 * is a single atomic statement — INSERT ... ON CONFLICT DO UPDATE ... WHERE the
 * existing claim has expired — so exactly one caller comes away holding it.
 * The loser returns the winner's profile instead of generating.
 *
 * ─── THE WINDOW ─────────────────────────────────────────────────────────────
 *
 * Minutes, not days. Long enough that a double-click, a refresh or an impatient
 * second operator returns the existing profile; short enough that a genuine
 * re-run next quarter still works, because comparables move.
 */
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';

/** How long one property stays claimed. Minutes, deliberately. */
export const CONCIERGE_CLAIM_WINDOW_MINUTES = 15;

export interface PropertyAddress {
  street: string;
  city: string;
  state: string;
  zip: string;
}

/**
 * The pre-spend key: the address, reduced to what two people typing the same
 * property would both produce. Case, punctuation, doubled spaces and a trailing
 * ZIP+4 must not buy a second report.
 */
export function propertyRequestKey(a: PropertyAddress): string {
  const part = (v: string) => (v ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  const zip = part(a.zip).slice(0, 5);
  return [part(a.street), part(a.city), part(a.state), zip].join('|').slice(0, 200);
}

export type ClaimResult =
  | { held: true }
  | { held: false; profileId: number | null; claimedAt: Date };

/**
 * Take the claim for this property, or report who holds it.
 *
 * `held: true` means this caller may spend. `held: false` means a request
 * within the window already did — `profileId` is its profile, or null while
 * that generation is still in flight.
 */
export async function claimProperty(requestKey: string, windowMinutes = CONCIERGE_CLAIM_WINDOW_MINUTES): Promise<ClaimResult> {
  const cutoff = sql.raw(`now() - interval '${Number(windowMinutes)} minutes'`);
  const won = await db.execute(sql`
    insert into concierge_profile_claims as c (request_key, claimed_at)
    values (${requestKey}, now())
    on conflict (request_key) do update
      set claimed_at = now(), profile_id = null, apn = null
      where c.claimed_at < ${cutoff}
    returning request_key
  `) as unknown as Array<{ request_key: string }>;

  if (won.length > 0) return { held: true };

  const rows = await db.execute(sql`
    select profile_id, claimed_at::text as claimed_at
    from concierge_profile_claims where request_key = ${requestKey}
  `) as unknown as Array<{ profile_id: number | null; claimed_at: string }>;
  const row = rows[0];
  return {
    held: false,
    profileId: row?.profile_id ?? null,
    claimedAt: row ? new Date(`${row.claimed_at.replace(' ', 'T')}Z`) : new Date(),
  };
}

/** Record which profile the claim produced, and which property it turned out to be. */
export async function recordClaimOutcome(requestKey: string, profileId: number, apn: string | null): Promise<void> {
  await db.execute(sql`
    update concierge_profile_claims
       set profile_id = ${profileId}, apn = ${apn}
     where request_key = ${requestKey}
  `);
}

/**
 * Give the claim back. Called ONLY when nothing was spent — a network failure
 * or a refused configuration must not lock a property out for the window. A
 * generation that charged keeps its claim: the credit is gone, and the next
 * click must not spend another.
 */
export async function releaseClaim(requestKey: string): Promise<void> {
  await db.execute(sql`delete from concierge_profile_claims where request_key = ${requestKey}`);
}
