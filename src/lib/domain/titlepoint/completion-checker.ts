import { db } from '@/lib/db/client';
import { titlePointData, eventOutbox, orders } from '@/lib/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { getSetting } from '@/lib/domain/settings/service';

const REQUIRED_SEARCH_TYPES = ['legal_vesting', 'tax', 'grant_deed'] as const;

const DEFAULT_CONFIRMATION_TIMEOUT_MINUTES = 10;

export interface CompletionCheckResult {
  complete: boolean;
  missing?: string[];
}

export type ConfirmationEnqueueReason = 'complete' | 'timeout' | 'hard_fail';

export interface ConfirmationReadiness {
  ready: boolean;
  reason?: ConfirmationEnqueueReason;
  missing: string[];
  noDocuments: boolean;
}

export async function checkTitlePointCompletion(
  orderId: number
): Promise<CompletionCheckResult> {
  const records = await db
    .select({ searchType: titlePointData.searchType, status: titlePointData.status })
    .from(titlePointData)
    .where(eq(titlePointData.orderId, orderId));

  const completedTypes = new Set(
    records
      .filter((r) => r.status === 'completed')
      .map((r) => r.searchType)
  );

  const missing = REQUIRED_SEARCH_TYPES.filter((t) => !completedTypes.has(t));

  return missing.length === 0
    ? { complete: true }
    : { complete: false, missing };
}

export async function hasConfirmationBeenSent(orderId: number): Promise<boolean> {
  const [existing] = await db
    .select({ id: eventOutbox.id })
    .from(eventOutbox)
    .where(
      and(
        eq(eventOutbox.orderId, orderId),
        eq(eventOutbox.eventType, 'order.confirmation'),
      )
    )
    .limit(1);

  return !!existing;
}

async function getConfirmationTimeoutMinutes(): Promise<number> {
  const raw = await getSetting('open_order_confirmation_timeout_minutes');
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_CONFIRMATION_TIMEOUT_MINUTES;
  return parsed;
}

/**
 * Decide whether confirmation may be enqueued now.
 * Waits for all three docs when possible; falls back on hard-fail or timeout
 * so a TitlePoint failure never blocks the email forever.
 */
export async function getConfirmationReadiness(orderId: number): Promise<ConfirmationReadiness> {
  const records = await db
    .select({
      searchType: titlePointData.searchType,
      status: titlePointData.status,
      createdAt: titlePointData.createdAt,
    })
    .from(titlePointData)
    .where(eq(titlePointData.orderId, orderId));

  const byType = new Map<string, { status: string; createdAt: Date | null }>();
  for (const row of records) {
    if (!row.searchType || !row.status) continue;
    const prev = byType.get(row.searchType);
    if (!prev) {
      byType.set(row.searchType, { status: row.status, createdAt: row.createdAt });
      continue;
    }
    const rank = (s: string) => (s === 'completed' ? 3 : s === 'failed' ? 2 : s === 'superseded' ? 0 : 1);
    if (rank(row.status) >= rank(prev.status)) {
      byType.set(row.searchType, { status: row.status, createdAt: row.createdAt });
    }
  }

  const missing = REQUIRED_SEARCH_TYPES.filter((t) => byType.get(t)?.status !== 'completed');
  const completedCount = REQUIRED_SEARCH_TYPES.length - missing.length;
  const noDocuments = completedCount === 0;

  if (missing.length === 0) {
    return { ready: true, reason: 'complete', missing: [], noDocuments: false };
  }

  const hardFailed = missing.some((t) => byType.get(t)?.status === 'failed');
  if (hardFailed) {
    return { ready: true, reason: 'hard_fail', missing, noDocuments };
  }

  const [orderRow] = await db
    .select({ createdAt: orders.createdAt, openedAt: orders.openedAt })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  const timeoutMinutes = await getConfirmationTimeoutMinutes();
  const anchor = orderRow?.openedAt ?? orderRow?.createdAt ?? null;
  if (anchor) {
    const ageMs = Date.now() - new Date(anchor).getTime();
    if (ageMs >= timeoutMinutes * 60_000) {
      return { ready: true, reason: 'timeout', missing, noDocuments };
    }
  }

  return { ready: false, missing, noDocuments };
}

export async function maybeEnqueueConfirmation(orderId: number): Promise<boolean> {
  const enabled = await getSetting('open_order_confirmation_enabled');
  if (enabled === 'false') return false;

  const alreadySent = await hasConfirmationBeenSent(orderId);
  if (alreadySent) return false;

  const readiness = await getConfirmationReadiness(orderId);
  if (!readiness.ready) return false;

  await db.insert(eventOutbox).values({
    eventType: 'order.confirmation',
    orderId,
    payload: {
      noDocuments: readiness.noDocuments,
      enqueueReason: readiness.reason,
      missingSearches: readiness.missing,
    } as Record<string, unknown>,
  });

  return true;
}

/**
 * Sweep open orders whose confirmation is stuck waiting on TitlePoint.
 * Called from the outbox processor so timeout/hard-fail paths enqueue without a TP queue consumer.
 */
export async function sweepPendingConfirmations(limit = 25): Promise<{ checked: number; enqueued: number }> {
  const enabled = await getSetting('open_order_confirmation_enabled');
  if (enabled === 'false') return { checked: 0, enqueued: 0 };

  const timeoutMinutes = await getConfirmationTimeoutMinutes();
  const cutoffIso = new Date(Date.now() - timeoutMinutes * 60_000).toISOString();

  const candidates = await db.execute(sql`
    select o.id
    from orders o
    where o.operational_status in ('open', 'in_process', 'completed')
      and exists (
        select 1 from title_point_data t where t.order_id = o.id
      )
      and not exists (
        select 1 from event_outbox e
        where e.order_id = o.id and e.event_type = 'order.confirmation'
      )
      and (
        coalesce(o.opened_at, o.created_at) <= ${cutoffIso}::timestamp
        or exists (
          select 1 from title_point_data t
          where t.order_id = o.id
            and t.search_type in ('legal_vesting', 'tax', 'grant_deed')
            and t.status = 'failed'
        )
      )
    order by coalesce(o.opened_at, o.created_at) asc
    limit ${limit}
  `);

  const rows = candidates as unknown as Array<{ id: number }>;
  let enqueued = 0;
  for (const row of rows) {
    try {
      if (await maybeEnqueueConfirmation(row.id)) enqueued++;
    } catch { /* continue sweep */ }
  }

  return { checked: rows.length, enqueued };
}
