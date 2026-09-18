/**
 * Re-examine prelims held blocked_no_recipient after a recipient appears.
 *
 * Fetch and ingest store the PDF and try once. When that try finds nobody,
 * nothing comes back. Enrich can write an escrow party hours later; the
 * prelim stays held. As of 2026-09-18 that was 51 of 68 hub-resolve holds.
 *
 * This job is that second look. It goes through maybeAutoDeliverPrelim, so
 * the three-day age guard and the pre-send SoftPro check still run. It does
 * not use the admin send path, and it does not substitute our address when
 * SoftPro has none (the rule change that would have released the three
 * Green Forest files).
 *
 * Only hub-resolve holds are picked (`No valid primary prelim recipient
 * resolved`). SoftPro-empty holds are a different stop — SoftPro was asked
 * and had nobody — and are left alone.
 *
 * Orders that still have no escrow officer and no escrow_company party are
 * not retried. They are logged once as `prelim_held_no_escrow_party` — a
 * data gap on the order, not a delivery bug.
 *
 * Rate: one maybeAutoDeliver at a time, 5s pause between calls. Each retry
 * may make one GetOrderContacts. Ceiling: 50 orders, youngest first, so a
 * run cannot walk the historical hold pile. `payload.limit` is required —
 * an empty invoke refuses rather than sending the whole in-window set.
 * Not a cron.
 */

import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { adminActivityLogs } from '@/lib/db/schema';
import { maybeAutoDeliverPrelim } from '@/lib/domain/notifications/prelim-auto-delivery';
import { resolvePrelimRecipients } from '@/lib/domain/notifications/prelim-recipient-resolution';

export const HUB_RESOLVE_BLOCK_REASON = 'No valid primary prelim recipient resolved';
export const NO_ESCROW_PARTY_ACTION = 'prelim_held_no_escrow_party';
export const RETRY_HELD_NO_RECIPIENT_CEILING = 50;
export const RETRY_HELD_NO_RECIPIENT_PAUSE_MS = 5_000;

export interface RetryHeldNoRecipientRow {
  fileNumber: string;
  orderId: number;
  documentId: number;
  kind: 'retry' | 'no_escrow_party';
  outcome: string;
  sent: boolean;
  reason?: string;
  issuedAtSource?: string;
}

export interface RetryHeldNoRecipientResult {
  limit: number;
  examined: number;
  retried: number;
  sent: number;
  loggedNoEscrowParty: number;
  rows: RetryHeldNoRecipientRow[];
}

export function parseRetryHeldNoRecipientLimit(payload: Record<string, unknown>): number {
  if (!Object.prototype.hasOwnProperty.call(payload, 'limit')) {
    throw new Error(
      'prelim.retry_held_no_recipient requires payload.limit — refusing to run uncapped',
    );
  }
  const raw = payload.limit;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1 || raw > RETRY_HELD_NO_RECIPIENT_CEILING) {
    throw new Error(
      `payload.limit must be an integer from 1 to ${RETRY_HELD_NO_RECIPIENT_CEILING}, got ${JSON.stringify(raw)}`,
    );
  }
  return raw;
}

interface HeldRow {
  document_id: number;
  order_id: number;
  file_number: string;
  document_created_at: Date | string;
  occurred_at: string | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseOccurredAt(raw: string | null): Date | null {
  if (!raw?.trim()) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

async function alreadyLoggedNoEscrowParty(documentId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: adminActivityLogs.id })
    .from(adminActivityLogs)
    .where(and(
      eq(adminActivityLogs.action, NO_ESCROW_PARTY_ACTION),
      sql`(${adminActivityLogs.meta}->>'document_id')::int = ${documentId}`,
    ))
    .limit(1);
  return !!row;
}

async function logNoEscrowParty(row: HeldRow): Promise<void> {
  await db.insert(adminActivityLogs).values({
    userId: 'system:retry_held_no_recipient',
    action: NO_ESCROW_PARTY_ACTION,
    entityType: 'order',
    entityId: String(row.order_id),
    meta: {
      document_id: row.document_id,
      file_number: row.file_number,
      reason: 'no escrow officer and no escrow_company party — retry cannot create a recipient',
    },
  });
}

async function loadHeldHubResolve(retryLimit: number): Promise<HeldRow[]> {
  const limit = retryLimit + 20;
  const rows = await db.execute(sql`
    with latest as (
      select distinct on ((a.meta->>'document_id')::int)
        (a.meta->>'document_id')::int as document_id,
        (a.entity_id)::int as order_id,
        a.meta->>'outcome' as outcome,
        a.meta->>'reason' as reason
      from admin_activity_logs a
      where a.action = 'prelim_auto_delivery'
        and a.meta ? 'document_id'
      order by (a.meta->>'document_id')::int, a.created_at desc
    )
    select
      l.document_id,
      l.order_id,
      o.file_number,
      d.created_at as document_created_at,
      (
        select da.meta->>'occurredAt'
        from document_audit da
        where da.document_id = d.id
          and da.action = 'uploaded'
        order by da.performed_at desc, da.id desc
        limit 1
      ) as occurred_at
    from latest l
    join documents d on d.id = l.document_id
    join orders o on o.id = l.order_id
    where l.outcome = 'blocked_no_recipient'
      and l.reason = ${HUB_RESOLVE_BLOCK_REASON}
      and d.category = 'prelim'
      and d.status = 'active'
      and not exists (
        select 1 from admin_activity_logs del
        where (
          del.action = 'prelim_delivered'
          and (del.meta->>'document_id')::int = l.document_id
        ) or (
          del.action = 'prelim_auto_delivery'
          and (del.meta->>'document_id')::int = l.document_id
          and del.meta->>'outcome' = 'delivered'
        )
      )
    order by o.opened_at desc nulls last
    limit ${limit}
  `) as unknown as HeldRow[];
  return rows;
}

export async function handleRetryHeldPrelimNoRecipient(
  payload: Record<string, unknown> = {},
): Promise<RetryHeldNoRecipientResult> {
  const limit = parseRetryHeldNoRecipientLimit(payload);
  const held = await loadHeldHubResolve(limit);
  const rows: RetryHeldNoRecipientRow[] = [];
  let retried = 0;
  let loggedNoEscrowParty = 0;

  for (const heldRow of held) {
    const recipients = await resolvePrelimRecipients(heldRow.order_id);
    if (recipients.blocked || !recipients.to) {
      if (!(await alreadyLoggedNoEscrowParty(heldRow.document_id))) {
        await logNoEscrowParty(heldRow);
        loggedNoEscrowParty++;
        rows.push({
          fileNumber: heldRow.file_number,
          orderId: heldRow.order_id,
          documentId: heldRow.document_id,
          kind: 'no_escrow_party',
          outcome: NO_ESCROW_PARTY_ACTION,
          sent: false,
          reason: 'no escrow officer and no escrow_company party',
        });
      }
      continue;
    }

    if (retried >= limit) break;
    if (retried > 0) await sleep(RETRY_HELD_NO_RECIPIENT_PAUSE_MS);
    retried++;

    const delivery = await maybeAutoDeliverPrelim({
      orderId: heldRow.order_id,
      documentId: heldRow.document_id,
      documentCreatedAt: asDate(heldRow.document_created_at),
      softproDocumentAt: parseOccurredAt(heldRow.occurred_at),
      triggeredBy: 'retry_held_no_recipient',
    });

    rows.push({
      fileNumber: heldRow.file_number,
      orderId: heldRow.order_id,
      documentId: heldRow.document_id,
      kind: 'retry',
      outcome: delivery.outcome,
      sent: delivery.sent,
      reason: delivery.reason,
      issuedAtSource: delivery.issuedAtSource,
    });
  }

  return {
    limit,
    examined: held.length,
    retried,
    sent: rows.filter((row) => row.sent).length,
    loggedNoEscrowParty,
    rows,
  };
}
