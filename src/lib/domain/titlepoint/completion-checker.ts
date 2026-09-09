import { db } from '@/lib/db/client';
import { titlePointData, eventOutbox, orders } from '@/lib/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { getSetting } from '@/lib/domain/settings/service';

// Defined in notifications/confirmation-documents.ts, which is a leaf module
// with no db import so the email template can read it too. Re-exported here so
// existing importers are unchanged, and so the rule has ONE definition — the
// confirmation body and the confirmation gate must not drift apart.
export { CONFIRMATION_OPTIONAL_DOC_TYPES } from '@/lib/domain/notifications/confirmation-documents';

/**
 * Legacy Order.php gate: enqueue when TAX + LV are TERMINAL
 * (success/failed/exception) — do NOT require success, do NOT wait on grant deed.
 */
export const CONFIRMATION_GATED_SEARCH_TYPES = ['legal_vesting', 'tax'] as const;

/** Terminal TitlePoint search outcomes (PDF may or may not exist). */
export const TERMINAL_TITLEPOINT_STATUSES = new Set([
  'completed',
  'failed',
]);

/*
  25, not 10.

  10 was set below the tail of the distribution it is meant to bound. Measured
  over 236 completed legal-vesting searches: p50 7.1 min, p75 11.3, p90 15.6,
  p95 24.8, p99 61.0. So **34% of searches ran past the timeout**, the clock won,
  and the confirmation went out mid-search — 18.9% of orders had their grant
  deed created after their email was sent, 19.6% their legal vesting.

  25 catches 95.3%. It costs orders that finish fast NOTHING: the branch above
  returns ready/'complete' as soon as both gated searches are terminal, and it
  returns before this value is read. The clock is only consulted when something
  is still missing. So the only orders affected are ones that would have sent
  incomplete — 68 of 236 now send complete instead, and 11 still send incomplete
  but 15 minutes later than they used to.

  This is a stopgap. See docs/tickets/CONFIRMATION_SENDS_BEFORE_DOCUMENTS_EXIST.md
  and the note further down: the pipeline rebuild removes the clock entirely, so
  there is no timeout to size. Do not treat a better number as the fix.
*/
const DEFAULT_CONFIRMATION_TIMEOUT_MINUTES = 25;

export interface CompletionCheckResult {
  complete: boolean;
  missing?: string[];
}

export type ConfirmationEnqueueReason = 'complete' | 'timeout' | 'hard_fail';

export interface ConfirmationReadiness {
  ready: boolean;
  reason?: ConfirmationEnqueueReason;
  missing: string[];
  /** True when neither gated search produced a completed PDF row. */
  noDocuments: boolean;
}

export function isTerminalTitlePointStatus(status: string | null | undefined): boolean {
  return !!status && TERMINAL_TITLEPOINT_STATUSES.has(status);
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

  // Full-doc completeness (UI / ops) still tracks LV+tax+grant_deed completed.
  const required = ['legal_vesting', 'tax', 'grant_deed'] as const;
  const missing = required.filter((t) => !completedTypes.has(t));

  return missing.length === 0
    ? { complete: true }
    : { complete: false, missing: [...missing] };
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

  if (existing) return true;

  // email_status guard — prevent double-send if outbox row was cleared/lost.
  const [orderRow] = await db
    .select({ emailStatus: orders.emailStatus })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  const status = orderRow?.emailStatus ?? '';
  return status === 'sent' || status === 'sent_no_client';
}

async function getConfirmationTimeoutMinutes(): Promise<number> {
  const raw = await getSetting('open_order_confirmation_timeout_minutes');
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_CONFIRMATION_TIMEOUT_MINUTES;
  return parsed;
}

function rankStatus(s: string): number {
  if (s === 'completed') return 4;
  if (s === 'failed') return 3;
  if (s === 'result_ready') return 2;
  if (s === 'superseded') return 0;
  return 1;
}

/**
 * Decide whether confirmation may be enqueued now (legacy-style).
 * Ready when TAX + LV are both terminal (completed/failed) — grant deed never gates.
 * Timeout remains the outer bound if either is still in-flight.
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
    if (rankStatus(row.status) >= rankStatus(prev.status)) {
      byType.set(row.searchType, { status: row.status, createdAt: row.createdAt });
    }
  }

  const missing = CONFIRMATION_GATED_SEARCH_TYPES.filter(
    (t) => !isTerminalTitlePointStatus(byType.get(t)?.status),
  );
  const completedPdfCount = CONFIRMATION_GATED_SEARCH_TYPES.filter(
    (t) => byType.get(t)?.status === 'completed',
  ).length;
  const noDocuments = completedPdfCount === 0;

  if (missing.length === 0) {
    // Both Tax+LV terminal — success or failed. Grant deed ignored.
    const anyFailed = CONFIRMATION_GATED_SEARCH_TYPES.some(
      (t) => byType.get(t)?.status === 'failed',
    );
    return {
      ready: true,
      reason: anyFailed ? 'hard_fail' : 'complete',
      missing: [],
      noDocuments,
    };
  }

  // Do NOT hard-fail early when only one of Tax/LV failed while the other is still in-flight.
  // Wait for both terminals or the timeout outer bound (legacy).

  // ─── THE TIMEOUT IS MEASURED FROM THE SEARCH, NOT FROM THE ORDER ─────────
  //
  // This used to anchor on `orders.openedAt ?? orders.createdAt`, which asks
  // "how old is this order?" when the question is "how long have these searches
  // been running?". On an order created within the last ten minutes the two
  // coincide, which is why it went unnoticed.
  //
  // On ANY LATE RE-TRIGGER they do not. Order 8136 was created on 1 September;
  // TitlePoint was started on it a day later after its missing county was
  // filled in. The order was ~24h old, the window is 10 minutes, so the very
  // first readiness check returned `timeout` THREE SECONDS after the searches
  // began — and a confirmation went to the escrow company saying there were no
  // documents. Two minutes later all three completed.
  //
  // Anchoring on the earliest search means the outer bound starts when the work
  // starts. A search begun now gets its full window however old the order is.
  //
  // NO SEARCHES AT ALL means there is nothing to wait for, so the order-level
  // anchor still applies — that is the genuinely-nothing-started case, and it
  // must stay ready or an order with no TitlePoint would never confirm.
  //
  // ─── THIS WHOLE MECHANISM GOES AWAY IN THE PIPELINE REBUILD ──────────────
  //
  // Phase C is sequential: C2 (send the confirmation) cannot begin until C1
  // (all documents terminal) has finished. There is no clock and therefore no
  // anchor to get wrong. Clock-based readiness is precisely what the rebuild
  // removes; this fix is what keeps it honest until then.
  // See docs/tickets/OPEN_ORDER_PIPELINE_REBUILD.md.
  const timeoutMinutes = await getConfirmationTimeoutMinutes();

  const searchStarts = records
    .map((r) => r.createdAt)
    .filter((d): d is Date => d instanceof Date);

  let anchor: Date | null = null;
  if (searchStarts.length > 0) {
    anchor = new Date(Math.min(...searchStarts.map((d) => d.getTime())));
  } else {
    const [orderRow] = await db
      .select({ createdAt: orders.createdAt, openedAt: orders.openedAt })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);
    anchor = orderRow?.openedAt ?? orderRow?.createdAt ?? null;
  }

  if (anchor) {
    const ageMs = Date.now() - new Date(anchor).getTime();
    if (ageMs >= timeoutMinutes * 60_000) {
      return { ready: true, reason: 'timeout', missing: [...missing], noDocuments };
    }
  }

  return { ready: false, missing: [...missing], noDocuments };
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
 * Called from the outbox processor so the timeout path enqueues without a TP consumer.
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
      and coalesce(o.email_status, 'pending') not in ('sent', 'sent_no_client')
      and (
        coalesce(o.opened_at, o.created_at) <= ${cutoffIso}::timestamp
        or (
          exists (
            select 1 from title_point_data t
            where t.order_id = o.id
              and t.search_type = 'legal_vesting'
              and t.status in ('completed', 'failed')
          )
          and exists (
            select 1 from title_point_data t
            where t.order_id = o.id
              and t.search_type = 'tax'
              and t.status in ('completed', 'failed')
          )
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
