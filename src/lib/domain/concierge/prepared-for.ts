import { and, eq, isNotNull, ne, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { conciergeProfiles } from '@/lib/db/schema/concierge';

export interface PreparedForSuggestion {
  name: string;
  company: string | null;
  /** How many profiles exist for them, across the company. */
  used: number;
  /** ISO date of the most recent one. */
  lastUsed: string | null;
  /** This operator has used the name before. Ranks it above the team's. */
  mine: boolean;
}

/**
 * Names this operator has prepared profiles for, most useful first.
 *
 * AN INDEX OVER WHAT IS ALREADY STORED, not a second store of client
 * identities. prepared_for_name and prepared_for_company are written on every
 * generate; this reads them back. That matters because the alternative —
 * autocompleting from `contacts` — offers a list that demonstrably does not
 * contain what operators type: all six prepared-for names on existing profiles
 * match no contact at all, and contacts carries 2,792 email addresses spread
 * over more than one row, so a picker there would offer the same person twice.
 *
 * ─── COMPANY-WIDE, THE OPERATOR'S OWN FIRST (reversed 2026-10-05) ───────────
 *
 * This was scoped to one operator, on the reasoning that prepared-for names are
 * a rep's client list and one rep should not see another's. That argument does
 * not survive contact with the hub: EVERY OPERATOR AT PCT CAN ALREADY SEE EVERY
 * ORDER AND EVERY PARTY ON IT. The same agent names are in plain sight across
 * the whole system. Hiding them in one autocomplete was not privacy, it was a
 * worse feature with a privacy-shaped explanation.
 *
 * The stronger reason is observability. A personal list on a handful of
 * profiles is legitimately empty most of the time, and an empty list is
 * indistinguishable from a broken one — which is exactly how this endpoint
 * returned nothing for five days without anybody being able to tell.
 *
 * POOLED, BUT RANKED OWN-FIRST. The operator's own history sits at the top and
 * the team's underneath, which beats either alone: the name they are most
 * likely to want is theirs, and the one they cannot remember is somebody's.
 *
 * RANKED BY FREQUENCY, THEN RECENCY. A name typed once is more likely a typo
 * than a client, and prefix-matching alone would offer it forever with the
 * same weight as the real one. Frequency demotes it without anyone having to
 * clean anything up.
 */
/**
 * @param createdBy the operator's EMAIL, because that is what
 *   concierge_profiles.created_by holds — the generate route writes
 *   `createdBy: session.email`. Passing session.id here matches nothing, which
 *   is exactly what happened from 2026-09-30 to 2026-10-05.
 */
export async function preparedForSuggestions(
  createdBy: string,
  query: string,
  limit = 8,
): Promise<PreparedForSuggestion[]> {
  const q = query.trim();
  // No identified operator means something upstream is wrong — the route
  // requires a session. The list is company-wide now, so this is not a privacy
  // guard any more; it is a refusal to serve a ranked list with nothing to rank
  // it by, from a caller that should not exist.
  if (!createdBy) return [];

  const rows = await db
    .select({
      name: conciergeProfiles.preparedForName,
      // THE MOST RECENT BROKERAGE, not the lexically greatest.
      //
      // This was max(), which on the real data picks "JOhn Smith" as John
      // Smith's brokerage — a typo from one profile in September, chosen over
      // "ABC Realty" because capital O sorts high. Picking the suggestion would
      // autofill that into the field.
      //
      // The latest one is the best guess available: a brokerage that changed is
      // more likely current, and a typo is more likely to have been corrected
      // since than introduced since.
      company: sql<string | null>`(array_agg(${conciergeProfiles.preparedForCompany} ORDER BY ${conciergeProfiles.createdAt} DESC))[1]`,
      used: sql<number>`count(*)::int`,
      lastUsed: sql<string | null>`max(${conciergeProfiles.createdAt})::text`,
      // CASE-INSENSITIVE, and it is a ranking input now rather than a filter.
      // An email that round-trips through a different identity provider can
      // come back capitalised differently, and the failure mode of an exact
      // match on this column is a silently empty list — which is precisely the
      // failure it has already produced once.
      mine: sql<boolean>`bool_or(lower(${conciergeProfiles.createdBy}) = lower(${createdBy}))`,
    })
    .from(conciergeProfiles)
    .where(and(
      // NO created_by FILTER. Pooled across the company — see the docblock.
      isNotNull(conciergeProfiles.preparedForName),
      ne(conciergeProfiles.preparedForName, ''),
      // Matched anywhere, not just as a prefix: operators reach for a surname
      // as often as a first name.
      q === '' ? sql`true` : sql`${conciergeProfiles.preparedForName} ILIKE ${`%${q}%`}`,
    ))
    .groupBy(conciergeProfiles.preparedForName)
    // Own first, then frequency, then recency. `true` sorts above `false` under
    // DESC in Postgres, so this is the operator's own history at the top and the
    // team's underneath — not a separate query, just an extra sort key.
    .orderBy(sql`bool_or(lower(${conciergeProfiles.createdBy}) = lower(${createdBy})) DESC, count(*) DESC, max(${conciergeProfiles.createdAt}) DESC`)
    .limit(limit);

  return rows
    .filter((r): r is typeof r & { name: string } => !!r.name)
    .map((r) => ({
      name: r.name,
      company: r.company ?? null,
      used: Number(r.used),
      lastUsed: r.lastUsed ? String(r.lastUsed).slice(0, 10) : null,
      mine: r.mine === true,
    }));
}
