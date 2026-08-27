/**
 * READ-ONLY check that the new enrich picker predicate does what the change
 * claims, using the predicate itself rather than a re-typed copy of it.
 *
 * `contactsFetchDue()` replaced two ANDed arms — a hard
 * `contacts_empty_confirmed = false` filter plus a flat 6-hour staleness gate —
 * with one per-order interval that lengthens to 7 days when the flag is set.
 * The claim under review is that this adds ~90 orders to the eligible pool
 * without changing per-run vendor call volume, since a run is capped at
 * SOFTPRO_ENRICH_ORDERS_BATCH_SIZE either way.
 *
 * Counts only. No vendor calls, no writes.
 *
 *   npx tsx --env-file=.env.local scripts/audit/enrich-picker-volume.ts
 */
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { orders, orderParties } from '@/lib/db/schema';
import { contactsFetchDue } from '@/lib/jobs/handlers/enrich-orders';

/** The picker's "this order is still missing something" arm, verbatim. */
function needsData() {
  return or(
    and(
      isNull(orders.lenderId),
      isNull(orders.listingAgentId),
      isNull(orders.titleCompanyId),
      isNull(orders.underwriterId),
    ),
    isNull(orders.clientContactId),
    sql`NOT EXISTS (SELECT 1 FROM ${orderParties} op WHERE op.order_id = ${orders.id})`,
  );
}

/** What the picker filtered on before this change. */
function legacyFetchDue() {
  return and(
    or(isNull(orders.contactsEmptyConfirmed), eq(orders.contactsEmptyConfirmed, false)),
    or(
      isNull(orders.lastContactsFetchAt),
      sql`${orders.lastContactsFetchAt} < NOW() - INTERVAL '6 hours'`,
    ),
  );
}

async function countWhere(label: string, where: ReturnType<typeof needsData>) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(orders)
    .where(where);
  console.log(`${label}: ${row?.n ?? 0}`);
  return row?.n ?? 0;
}

async function main() {
  console.log('\n=== eligible population, old predicate vs new ===');
  const before = await countWhere('legacy   (latch excluded, 6h stale)   ', and(needsData(), legacyFetchDue()));
  const after = await countWhere('current  (latch expires after 7 days) ', and(needsData(), contactsFetchDue()));
  console.log(`delta: ${after - before} orders newly reachable`);

  console.log('\n=== of the new pool, how many are latched ===');
  await countWhere('latched and due                        ', and(
    needsData(),
    contactsFetchDue(),
    eq(orders.contactsEmptyConfirmed, true),
  ));
  await countWhere('latched but NOT yet due (<7d)          ', and(
    eq(orders.contactsEmptyConfirmed, true),
    sql`NOT (${contactsFetchDue()})`,
  ));

  console.log('\n=== the emitted SQL, for the record ===');
  console.log(db.select({ id: orders.id }).from(orders)
    .where(and(needsData(), contactsFetchDue())).toSQL().sql);

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
