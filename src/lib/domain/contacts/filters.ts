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
