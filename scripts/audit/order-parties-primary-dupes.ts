/**
 * READ-ONLY. Is (order_id, role, is_primary) already unique on order_parties?
 *
 *   npx tsx --env-file=.env.local scripts/audit/order-parties-primary-dupes.ts
 *
 * This is the measurement migration 0035 depends on. That migration adds a
 * UNIQUE index on the triple, and CREATE UNIQUE INDEX fails outright if any
 * duplicate exists — so the answer decides whether the constraint is applicable
 * at all or has to wait behind a cleanup.
 *
 * Counting (order_id, role) instead is the trap: 8,976 of 24,961 such pairs hold
 * more than one row, and every one of those is legitimate — buyer and seller
 * come in primary/secondary pairs and role='other' carries the title company as
 * primary with the underwriter as non-primary. Reading that number as "8,976
 * duplicates" would block a constraint that is in fact clean to apply.
 *
 * Also prints the roles where the two SoftPro writers and the party wizard ask
 * for is_primary = true, since a non-primary row under one of those roles is a
 * duplicate waiting for the next read-back:
 *
 *   enrich-orders.ts        upsertResolvedParty    lender, listing_agent,
 *                                                  escrow_company, lender_contact
 *   verify-order-sync.ts    reconcileParties       lender, escrow_company
 *   party-wizard-service.ts projectToOrderParties  listing_agent (v1)
 *
 * Writes nothing. Run it again after any cleanup the owner authorises.
 */
import { db } from '@/lib/db/client';
import { sql } from 'drizzle-orm';

/** Roles a reconciler or the wizard looks up with is_primary = true. */
const PRIMARY_EXPECTED_ROLES = [
  'lender', 'listing_agent', 'escrow_company', 'lender_contact', 'buyer', 'seller',
];

type Row = Record<string, unknown>;

async function query(text: string): Promise<Row[]> {
  return await db.execute(sql.raw(text)) as unknown as Row[];
}

function table(rows: Row[]): void {
  if (rows.length === 0) {
    console.log('  (no rows)');
    return;
  }
  const cols = Object.keys(rows[0]!);
  console.log('  ' + cols.map((c) => c.padEnd(28)).join(''));
  for (const r of rows) {
    console.log('  ' + cols.map((c) => String(r[c] ?? '').padEnd(28)).join(''));
  }
}

(async () => {
  console.log('\n=== Totals ===');
  table(await query(`
    with per_role as (
      select order_id, role, count(*) as n from public.order_parties group by 1, 2
    ), per_triple as (
      select order_id, role, is_primary, count(*) as n
      from public.order_parties group by 1, 2, 3
    )
    select
      (select count(*) from public.order_parties)        as total_rows,
      (select count(*) from per_role)                    as order_role_pairs,
      (select count(*) from per_role where n > 1)        as order_role_pairs_gt1,
      (select count(*) from per_triple)                  as triples,
      (select count(*) from per_triple where n > 1)      as triples_gt1,
      (select coalesce(sum(n - 1), 0) from per_triple where n > 1) as rows_blocking_0035
  `));
  console.log('\n  rows_blocking_0035 = 0 means migration 0035 applies as-is.');

  console.log('\n=== Any triple with more than one row (these would block 0035) ===');
  table(await query(`
    select order_id, role, is_primary, count(*) as n
    from public.order_parties
    group by 1, 2, 3
    having count(*) > 1
    order by n desc, order_id
    limit 50
  `));

  console.log('\n=== Shape by role and flag ===');
  table(await query(`
    select role, is_primary, count(*) as rows,
           count(distinct order_id) as orders,
           count(contact_id) as with_contact_id
    from public.order_parties
    group by 1, 2
    order by 1, 2
  `));

  console.log('\n=== Non-primary rows under a role the reconcilers file as primary ===');
  console.log('  Each of these is a party a read-back will duplicate rather than update.');
  table(await query(`
    select p.role, o.source, count(*) as rows,
           count(p.contact_id) as with_contact_id,
           min(p.created_at)::date as first_seen,
           max(p.created_at)::date as last_seen
    from public.order_parties p
    join public.orders o on o.id = p.order_id
    where p.is_primary = false
      and p.role in (${PRIMARY_EXPECTED_ROLES.map((r) => `'${r}'`).join(', ')})
    group by 1, 2
    order by 3 desc
  `));

  console.log('\n=== Orders holding BOTH a primary and a non-primary row for one role ===');
  console.log('  The duplicate-and-orphan outcome, already realised.');
  table(await query(`
    select p.order_id, o.source, p.role,
           count(*) as rows,
           min(p.created_at)::date as oldest,
           max(p.created_at)::date as newest
    from public.order_parties p
    join public.orders o on o.id = p.order_id
    where p.role not in ('buyer', 'seller', 'other')
    group by 1, 2, 3
    having count(*) > 1
    order by p.order_id
    limit 50
  `));

  console.log('\n=== Party rows on hub-created orders ===');
  console.log('  orders.source is the discriminator used here. A separate review is');
  console.log('  establishing how reliable it is, so treat this as indicative: the');
  console.log('  0035 verdict above does not depend on it, being table-wide.');
  table(await query(`
    select o.source, p.role, p.is_primary, count(*) as rows
    from public.orders o
    join public.order_parties p on p.order_id = o.id
    where o.source <> 'softpro_sync'
    group by 1, 2, 3
    order by 1, 2, 3
  `));

  process.exit(0);
})();
