import { count, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { contacts, orders, profiles } from '@/lib/db/schema';

/**
 * ─── Can the rep this report is for actually see it? ────────────────────────
 *
 * `/sales/reports` filters on `session.contactId` — the contact row the rep's
 * LOGIN points at. A farming report carries `branded_to_contact_id`, chosen by
 * an operator from a picker. Those are two different numbers, and nothing
 * checked that they could ever be the same one.
 *
 * KEVIN CAMERON IS THE LIVE CASE (2026-09-23). He is two active sales-rep
 * contact rows with the same name and the same email: `#8`, which his login
 * points at and which carries all 76 of his orders, and `#22265`, which has
 * neither. Branding a report to `22265` produces a report that is correct in
 * every respect — right figures, right name on the page, visible on the
 * operators' Reports list — except that KEVIN NEVER SEES IT. No error, no
 * warning, and the only person who would notice is the one person not shown it.
 *
 * So this is checked BEFORE the row is written, and the answer is carried back
 * to whoever is generating.
 *
 * IT WARNS, IT DOES NOT BLOCK. A report for a rep with no login is still a
 * perfectly good PDF to attach to an email, and refusing to make one would be
 * inventing a rule nobody asked for. The operator is told what will happen and
 * decides — the same shape as the concierge duplicate guard.
 */

export interface RepVisibility {
  contactId: number;
  /** A profile points at this contact, so the rep's own list can find it. */
  visibleToRep: boolean;
  /** Same name and email as this one, on a different row. The picker hazard. */
  twins: { id: number; hasLogin: boolean; orders: number }[];
  /** Plain words for an operator. Null when there is nothing to say. */
  warning: string | null;
}

/** The contact rows a login points at. One query, so a list can be checked cheaply. */
async function contactsWithLogins(ids: readonly number[]): Promise<Set<number>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ contactId: profiles.contactId })
    .from(profiles)
    .where(inArray(profiles.contactId, [...ids]));
  return new Set(rows.map((r) => r.contactId).filter((v): v is number => typeof v === 'number'));
}

export async function repVisibility(contactId: number): Promise<RepVisibility> {
  const [me] = await db
    .select({ id: contacts.id, name: contacts.fullName, email: contacts.email })
    .from(contacts).where(eq(contacts.id, contactId)).limit(1);

  if (!me) {
    return { contactId, visibleToRep: false, twins: [], warning: 'That representative could not be found.' };
  }

  // Rows a human could not tell apart in a picker: same name, same email.
  const siblings = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(sql`lower(coalesce(${contacts.fullName}, '')) = lower(coalesce(${me.name ?? ''}, ''))
           AND lower(coalesce(${contacts.email}, '')) = lower(coalesce(${me.email ?? ''}, ''))
           AND coalesce(${contacts.email}, '') <> ''
           AND ${contacts.id} <> ${contactId}`);

  // A SEPARATE AGGREGATE, not a correlated subquery. Drizzle renders
  // `${contacts.id}` inside a select list as bare "id", and inside
  // `(SELECT ... FROM orders o WHERE o.sales_rep_id = "id")` Postgres binds
  // that to ORDERS.id — the inner scope wins. The result is valid SQL, a
  // plausible number, and always zero. Caught by comparing the live answer for
  // Kevin Cameron (#8, 76 orders) against what this returned (0).
  const ids = siblings.map((s) => s.id);
  const counts = new Map<number, number>();
  if (ids.length > 0) {
    for (const r of await db
      .select({ repId: orders.salesRepId, n: count() })
      .from(orders)
      .where(inArray(orders.salesRepId, ids))
      .groupBy(orders.salesRepId)) {
      if (typeof r.repId === 'number') counts.set(r.repId, Number(r.n));
    }
  }

  const withLogin = await contactsWithLogins([contactId, ...ids]);
  const visibleToRep = withLogin.has(contactId);
  const twins = ids.map((id) => ({ id, hasLogin: withLogin.has(id), orders: counts.get(id) ?? 0 }));

  return { contactId, visibleToRep, twins, warning: warningFor(me.name, visibleToRep, twins) };
}

/**
 * The sentence an operator reads. Separated from the queries so the wording is
 * testable without a database, and so the two cases stay distinct: a rep with
 * no login at all is a different problem from a rep whose login is on the
 * OTHER row of a duplicate pair.
 */
export function warningFor(
  name: string | null,
  visibleToRep: boolean,
  twins: readonly { id: number; hasLogin: boolean; orders: number }[],
): string | null {
  if (visibleToRep) return null;
  const who = name?.trim() || 'This representative';
  const sibling = twins.find((t) => t.hasLogin);

  if (sibling) {
    // The dangerous case, and the one worth spelling out: the report would be
    // filed against a row that looks right and is not the one they log in as.
    return `${who} has a second contact record, and their login points at the other one `
      + `(#${sibling.id}${sibling.orders > 0 ? `, which carries ${sibling.orders} orders` : ''}). `
      + `A report branded to this record will NOT appear in their own Reports list. `
      + `Choose the other record, or send them the PDF directly.`;
  }
  return `${who} has no login, so this report will not appear in a Reports list for them. `
    + `The PDF is still correct and can be sent to them directly.`;
}

// ─── The picker must not offer two entries a human cannot tell apart ────────
//
// The New Report modal searches `/api/contacts/search?type=sales_rep`. For
// Kevin Cameron that returns TWO rows with the same name and the same email
// and nothing else on screen to separate them. An operator picking between
// them is guessing, and half the time the guess produces a report the rep
// never sees, with no error.
//
// So the search annotates them. Rows with no twin are untouched and carry no
// extra noise; only an ambiguous pair grows the facts that resolve it.

export interface RepTwinFacts {
  id: number;
  /** Their login points here, so reports branded here reach them. */
  hasLogin: boolean;
  /** Orders naming this row as sales rep — the other half of "which is real". */
  orders: number;
  /** True when another row in the book has the same name AND email. */
  ambiguous: boolean;
}

/**
 * Facts for a list of candidate reps, keyed by id. Two queries regardless of
 * how many rows, because a picker runs this on every keystroke.
 */
export async function repTwinFacts(
  candidates: readonly { id: number; fullName: string | null; email: string | null }[],
): Promise<Map<number, RepTwinFacts>> {
  const out = new Map<number, RepTwinFacts>();
  if (candidates.length === 0) return out;

  const key = (c: { fullName: string | null; email: string | null }) =>
    `${(c.fullName ?? '').trim().toLowerCase()}|${(c.email ?? '').trim().toLowerCase()}`;

  // Ambiguity is a fact about the BOOK, not about this page of results: two
  // twins can easily fall on either side of a LIMIT 8.
  const groups = new Map<string, number>();
  for (const c of candidates) {
    if (!(c.email ?? '').trim()) continue;
    groups.set(key(c), (groups.get(key(c)) ?? 0) + 1);
  }

  const ids = candidates.map((c) => c.id);
  const [logins, counts] = await Promise.all([
    contactsWithLogins(ids),
    db.select({ repId: orders.salesRepId, n: count() })
      .from(orders).where(inArray(orders.salesRepId, ids)).groupBy(orders.salesRepId),
  ]);
  const byRep = new Map<number, number>();
  for (const r of counts) if (typeof r.repId === 'number') byRep.set(r.repId, Number(r.n));

  for (const c of candidates) {
    out.set(c.id, {
      id: c.id,
      hasLogin: logins.has(c.id),
      orders: byRep.get(c.id) ?? 0,
      ambiguous: (groups.get(key(c)) ?? 0) > 1,
    });
  }
  return out;
}

/**
 * The line shown under an ambiguous entry. Short, because it sits in a
 * dropdown row — and factual, because the operator is choosing between two
 * identical names and needs the thing that differs.
 */
export function twinLabel(f: RepTwinFacts): string | null {
  if (!f.ambiguous) return null;
  const bits = [f.hasLogin ? 'has login' : 'NO login', `${f.orders} order${f.orders === 1 ? '' : 's'}`];
  return `Duplicate record — ${bits.join(' · ')}`;
}
