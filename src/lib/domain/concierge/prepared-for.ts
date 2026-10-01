import { and, eq, isNotNull, ne, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { conciergeProfiles } from '@/lib/db/schema/concierge';

export interface PreparedForSuggestion {
  name: string;
  company: string | null;
  /** How many profiles this operator has prepared for them. */
  used: number;
  /** ISO date of the most recent one. */
  lastUsed: string | null;
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
 * SCOPED TO THE OPERATOR, deliberately. Prepared-for names are a rep's client
 * list. Sales reps at a title company have their own books of business, and
 * suggesting to one rep the names another has been courting is a different
 * product from the one that was asked for. Widening this to the company later
 * is a one-line change; narrowing it after someone notices is not.
 *
 * RANKED BY FREQUENCY, THEN RECENCY. A name typed once is more likely a typo
 * than a client, and prefix-matching alone would offer it forever with the
 * same weight as the real one. Frequency demotes it without anyone having to
 * clean anything up.
 */
export async function preparedForSuggestions(
  createdBy: string,
  query: string,
  limit = 8,
): Promise<PreparedForSuggestion[]> {
  const q = query.trim();
  if (!createdBy) return [];

  const rows = await db
    .select({
      name: conciergeProfiles.preparedForName,
      company: sql<string | null>`max(${conciergeProfiles.preparedForCompany})`,
      used: sql<number>`count(*)::int`,
      lastUsed: sql<string | null>`max(${conciergeProfiles.createdAt})::text`,
    })
    .from(conciergeProfiles)
    .where(and(
      eq(conciergeProfiles.createdBy, createdBy),
      isNotNull(conciergeProfiles.preparedForName),
      ne(conciergeProfiles.preparedForName, ''),
      // Matched anywhere, not just as a prefix: operators reach for a surname
      // as often as a first name.
      q === '' ? sql`true` : sql`${conciergeProfiles.preparedForName} ILIKE ${`%${q}%`}`,
    ))
    .groupBy(conciergeProfiles.preparedForName)
    .orderBy(sql`count(*) DESC, max(${conciergeProfiles.createdAt}) DESC`)
    .limit(limit);

  return rows
    .filter((r): r is typeof r & { name: string } => !!r.name)
    .map((r) => ({
      name: r.name,
      company: r.company ?? null,
      used: Number(r.used),
      lastUsed: r.lastUsed ? String(r.lastUsed).slice(0, 10) : null,
    }));
}
