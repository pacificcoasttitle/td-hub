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
