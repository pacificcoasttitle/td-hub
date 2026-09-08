import { sql, SQL } from 'drizzle-orm';
import { contacts, profiles } from '@/lib/db/schema';

/** PCT-internal contacts: @pct.com login or linked app profile (TD Hub user). */
export function internalContactFilter(): SQL {
  return sql`(
    ${contacts.email} ILIKE '%@pct.com'
    OR EXISTS (
      SELECT 1 FROM ${profiles}
      WHERE ${profiles.contactId} = ${contacts.id}
    )
  )`;
}

/**
 * A PCT officer as SoftPro's own officer feeds define one: the `PCT\user` code
 * and the branch office code arrive together on a single feed row, and
 * syncTitleOfficers / syncEscrowOfficers store both on that contact.
 *
 * Every internal officer also exists a second time as an address-book row —
 * Anna Ballesteros is contact 12 (PRV) and contact 17165 (no office) — and the
 * address-book row is the one `is_escrow_officer` points at, because
 * reconcileEscrowOfficerFlagsFromOrders sets that flag on all 725 contacts ever
 * assigned to an order. Selecting the feed row instead is what keeps the branch
 * and the `PCT\` user code available to the payload builder.
 */
export function internalOfficerFilter(role: 'title_officer' | 'escrow_officer'): SQL {
  return sql`(
    ${contacts.roles}::jsonb @> ${JSON.stringify([role])}::jsonb
    AND left(${contacts.softproLookupCode}, 4) = ${'PCT\\'}
    AND ${contacts.officeLookupCode} IS NOT NULL
    AND ${contacts.officeLookupCode} <> ''
  )`;
}

/** Outside escrow officers / vendors — no @pct.com email and no linked profile row. */
export function externalContactFilter(): SQL {
  return sql`(
    (${contacts.email} IS NULL OR ${contacts.email} NOT ILIKE '%@pct.com')
    AND NOT EXISTS (
      SELECT 1 FROM ${profiles}
      WHERE ${profiles.contactId} = ${contacts.id}
    )
  )`;
}

/**
 * A row that names somebody.
 *
 * MEASURED 2026-09-09. The lender and mortgage-broker contact pages list 1,157
 * and 528 rows with no name in any column — no `full_name`, no `first_name`, no
 * `last_name`. They are not people missing a name. They are COMPANIES filed as
 * `type='person'`: every one carries a company-shaped lookup code (four letters
 * of the name plus four of the address, e.g. `Vict217L2`), every one has a
 * street address, none has a company name, and all arrived in the same
 * 2026-03-12 SoftPro import.
 *
 * Nothing renders for them — the list shows an em dash — and nothing can, since
 * only 3% carry an email and none carries a company name.
 *
 * HIDING THEM IS SAFE, and that was checked rather than assumed: all 1,159
 * exist on the company side already, 1,157 matching by exact lookup code and
 * the remaining 2 by address. Zero are the only record of their firm.
 *
 * HIDING IS THE PRESENTATION FIX, NOT THE REAL ONE. These rows are the wrong
 * type, and the actual repair is retyping them as companies — a data change on
 * live records, which is Gerard's call and deliberately not proposed here.
 *
 * Blast radius, also measured: nameless rows exist ONLY on those two types.
 * Escrow officers, real estate agents, title officers and sales reps have zero,
 * so applying this everywhere changes nothing on any existing page.
 */
export function namedContactFilter(): SQL {
  return sql`(
    coalesce(${contacts.fullName}, '') <> ''
    OR coalesce(${contacts.firstName}, '') <> ''
    OR coalesce(${contacts.lastName}, '') <> ''
  )`;
}
