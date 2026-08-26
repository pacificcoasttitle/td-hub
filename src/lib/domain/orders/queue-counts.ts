import { eq, type SQL } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { orderProperties, orders } from '@/lib/db/schema';
import type { HubQueueCounts } from './hub-queues';
import { QUEUE_COUNT_EXPRESSIONS } from './hub-queue-filters';

// ─── Queue rail counts ───────────────────────────────────────────────────────
//
// One statement, six numbers, computed server-side against the whole scoped set.
// Deriving them from the loaded page instead would make the ALL tile read "100"
// and the TDY tile undercount every time the list was filtered — the numbers
// would be a description of the page, not of the work.

export async function getQueueCounts(
  scopeFilter: SQL | null,
  now: Date,
): Promise<HubQueueCounts> {
  const [row] = await db
    .select({
      today: QUEUE_COUNT_EXPRESSIONS.today(now),
      missingAddress: QUEUE_COUNT_EXPRESSIONS.missingAddress(),
      noClient: QUEUE_COUNT_EXPRESSIONS.noClient(),
      syncFailed: QUEUE_COUNT_EXPRESSIONS.syncFailed(),
      cplPending: QUEUE_COUNT_EXPRESSIONS.cplPending(),
      all: QUEUE_COUNT_EXPRESSIONS.all(),
    })
    .from(orders)
    .leftJoin(orderProperties, eq(orders.id, orderProperties.orderId))
    .where(scopeFilter ?? undefined);

  return {
    today: Number(row?.today ?? 0),
    missingAddress: Number(row?.missingAddress ?? 0),
    noClient: Number(row?.noClient ?? 0),
    syncFailed: Number(row?.syncFailed ?? 0),
    cplPending: Number(row?.cplPending ?? 0),
    all: Number(row?.all ?? 0),
  };
}
