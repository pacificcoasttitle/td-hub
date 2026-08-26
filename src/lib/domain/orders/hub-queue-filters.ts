import { and, eq, isNull, or, sql, type SQL } from 'drizzle-orm';
import { documents, orderProperties, orders } from '@/lib/db/schema';
import { pacificMidnightUtc, pacificYmd } from '@/lib/domain/ops/calendar-day';
import { statusSqlList } from './status-map';
import {
  CPL_QUEUE_STATUSES,
  SYNC_FAILURE_WINDOW_DAYS,
  type HubQueueId,
} from './hub-queues';

// ─── SQL predicates behind the six queue tiles ───────────────────────────────
//
// One definition per queue, shared by the list endpoint and the count endpoint,
// so a tile can never show a number the list then disagrees with.

/**
 * Midnight Pacific at the start of the day containing `now`, as the instant to
 * compare opened_at against.
 *
 * opened_at is `timestamp without time zone` holding UTC instants — verified
 * against production: the newest row reads 2026-08-25T01:37:53Z, which is
 * 6:37pm Pacific on the 24th. So the boundary is computed as a UTC instant and
 * compared directly; there is no server-local time anywhere in the path.
 *
 * The boundary itself comes from the ops daily report's helper, which resolves
 * the offset iteratively and is therefore right on the two days a year when a
 * fixed -08:00 would be an hour out.
 */
export function pacificDayStart(now: Date): Date {
  return pacificMidnightUtc(pacificYmd(now));
}

/**
 * The boundary as Postgres needs to see it: 'YYYY-MM-DD HH:MM:SS'.
 *
 * opened_at is `timestamp without time zone`, so a bound JS Date is rejected by
 * the driver and a bound ISO string with a Z would be silently reinterpreted.
 * Emitting the UTC wall clock explicitly makes the comparison mean exactly what
 * the column stores.
 */
export function pacificDayStartLiteral(now: Date): string {
  return pacificDayStart(now).toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
}

const EMPTY_ADDRESS: SQL = or(
  isNull(orderProperties.address),
  eq(sql`trim(${orderProperties.address})`, ''),
)!;

/**
 * The most recent SoftPro or TitlePoint call scoped to this order failed, and
 * nothing has succeeded since.
 *
 * There is no sync_status column on orders — softpro_last_synced_at is set on
 * all 7,300 rows, so "never synced" is not a signal. The vendor call log is the
 * only place a failure is actually recorded, and 68 orders are in that state.
 *
 * Scoped to a window because vendor_api_logs holds 1.08M rows with no composite
 * index on (order_id, created_at): 7 days resolves in ~130ms, 30 days takes
 * 4.8s. A failure older than a week with nothing successful since is a stale
 * order, not a live problem — but the window is why this tile is a floor rather
 * than a total.
 *
 * Written as an uncorrelated IN, deliberately. The obvious `exists (... where
 * f.order_id = orders.id ...)` form is correct and was measured at 6.5s for the
 * rail, because the planner re-runs it once per order. This shape builds the
 * failing set once and probes it.
 */
function latestVendorCallFailed(): SQL {
  const cutoff = sql.raw(`now() - interval '${SYNC_FAILURE_WINDOW_DAYS} days'`);
  return sql`${orders.id} in (
    select x.order_id from (
      select f.order_id, max(f.created_at) as last_fail
      from vendor_api_logs f
      where f.order_id is not null
        and f.vendor in ('softpro', 'titlepoint')
        and f.success = false
        and f.created_at > ${cutoff}
      group by f.order_id
    ) x
    where not exists (
      select 1 from vendor_api_logs s
      where s.order_id = x.order_id
        and s.vendor in ('softpro', 'titlepoint')
        and s.success = true
        and s.created_at > x.last_fail
    )
  )`;
}

/**
 * Active order with no CPL document on file.
 *
 * The status cohort is imported, never typed as a literal — 'open' holds 2 rows
 * out of 7,300 and has silently broken three features already. See status-map.
 */
function cplPending(): SQL {
  const statuses = sql.raw(statusSqlList([...CPL_QUEUE_STATUSES]));
  return and(
    sql`${orders.operationalStatus} in (${statuses})`,
    sql`not exists (
      select 1 from ${documents} d
      where d.order_id = ${orders.id} and d.category = 'cpl' and d.status = 'active'
    )`,
  )!;
}

/**
 * The predicate for one queue, or null for ALL (which filters nothing).
 * `now` is a parameter so the TDY boundary is testable.
 */
export function queueFilter(queue: HubQueueId, now: Date): SQL | null {
  switch (queue) {
    case 'today':
      return sql`${orders.openedAt} >= ${pacificDayStartLiteral(now)}::timestamp`;
    case 'missingAddress':
      return EMPTY_ADDRESS;
    case 'noClient':
      return isNull(orders.clientContactId);
    case 'syncFailed':
      return latestVendorCallFailed();
    case 'cplPending':
      return cplPending();
    case 'all':
      return null;
  }
}

export const QUEUE_COUNT_EXPRESSIONS = {
  today: (now: Date) => sql<number>`count(*) filter (where ${orders.openedAt} >= ${pacificDayStartLiteral(now)}::timestamp)`,
  missingAddress: () => sql<number>`count(*) filter (where ${EMPTY_ADDRESS})`,
  noClient: () => sql<number>`count(*) filter (where ${orders.clientContactId} is null)`,
  syncFailed: () => sql<number>`count(*) filter (where ${latestVendorCallFailed()})`,
  cplPending: () => sql<number>`count(*) filter (where ${cplPending()})`,
  all: () => sql<number>`count(*)`,
};
