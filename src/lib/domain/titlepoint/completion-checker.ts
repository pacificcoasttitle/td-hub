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
