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
 * The picker is the same gates, applied before the walk: only hub-resolve
 * holds (`No valid primary prelim recipient resolved`) whose issued date is
 * still inside the three-day window and that now have a hub recipient.
 * SoftPro-empty holds, aged-out holds, and orders with no escrow party are
 * not loaded. They fall out as they age; a cron that rediscovered them every
 * hour would bury the rows that can still deliver.
 *
 * Rate: one maybeAutoDeliver at a time, 5s pause. Ceiling 50, youngest first.
 * A GET (the cron) has no body and defaults to the ceiling. A POST with a
 * body but a missing or malformed limit still refuses — that is the wrapper
 * check that caught the empty invoke on the first drain. Hourly at :20,
 * after the :15 enrich that writes the party.
 */

import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { adminActivityLogs } from '@/lib/db/schema';
import {
  maybeAutoDeliverPrelim,
  prelimAutoDeliveryWindowStart,
} from '@/lib/domain/notifications/prelim-auto-delivery';
import { resolvePrelimRecipients } from '@/lib/domain/notifications/prelim-recipient-resolution';

export const HUB_RESOLVE_BLOCK_REASON = 'No valid primary prelim recipient resolved';
export const NO_ESCROW_PARTY_ACTION = 'prelim_held_no_escrow_party';
export const RETRY_HELD_NO_RECIPIENT_RUN_ACTION = 'prelim_retry_held_no_recipient';
export const RETRY_HELD_NO_RECIPIENT_CEILING = 50;
export const RETRY_HELD_NO_RECIPIENT_PAUSE_MS = 5_000;

/** Same shape as resolvePrelimRecipients / isValidEmail, in POSIX (Postgres ~*). */
const EMAIL_SQL = '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$';

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

export interface RetryHeldNoRecipientHeld {
  fileNumber: string;
  outcome: string;
  reason: string | null;
}

export interface RetryHeldNoRecipientResult {
  limit: number;
  windowStart: string;
  examined: number;
  attempted: number;
  delivered: number;
  held: RetryHeldNoRecipientHeld[];
  heldByOutcome: Record<string, number>;
  loggedNoEscrowParty: number;
  rows: RetryHeldNoRecipientRow[];
  pickerError?: string;
}

export function parseRetryHeldNoRecipientLimit(payload: Record<string, unknown>): number {
  if (!Object.prototype.hasOwnProperty.call(payload, 'limit')) {
    if (payload.__invokedBy === 'cron') return RETRY_HELD_NO_RECIPIENT_CEILING;
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

function tally(rows: RetryHeldNoRecipientRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.outcome] = (counts[row.outcome] ?? 0) + 1;
  }
  return counts;
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

async function logRun(input: {
  jobId: number | null;
  windowStart: Date;
  result: RetryHeldNoRecipientResult;
}): Promise<void> {
  await db.insert(adminActivityLogs).values({
    userId: 'system:retry_held_no_recipient',
    action: RETRY_HELD_NO_RECIPIENT_RUN_ACTION,
    entityType: 'job',
    entityId: input.jobId !== null ? String(input.jobId) : 'prelim.retry_held_no_recipient',
    meta: {
      job_id: input.jobId,
      window_start: input.windowStart.toISOString(),
      limit: input.result.limit,
      examined: input.result.examined,
      attempted: input.result.attempted,
      delivered: input.result.delivered,
      held: input.result.held,
      held_by_outcome: input.result.heldByOutcome,
      picker_error: input.result.pickerError ?? null,
    },
  });
}

/**
 * Issued date is SoftPro's occurredAt when present, else orders.opened_at —
 * the same clock maybeAutoDeliverPrelim uses. Compared to the same
 * prelimAutoDeliveryWindowStart instant, not a second definition of "three days".
 *
 * Hub recipient matches resolvePrelimRecipients: officer FK wins and does
 * not fall back to the company party.
 */
async function loadDeliverableHeld(retryLimit: number, windowStart: Date): Promise<HeldRow[]> {
  // ISO string, not a Date: drizzle's Date bind became `Tue Sep 15 2026…`
  // and Postgres rejected it. The :20 cron failed on that, with no run log.
  const windowStartIso = windowStart.toISOString();
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
    ),
    candidates as (
      select
        l.document_id,
        l.order_id,
        o.file_number,
        o.opened_at,
        o.escrow_officer_id,
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
    )
    select
      c.document_id,
      c.order_id,
      c.file_number,
      c.document_created_at,
      c.occurred_at
    from candidates c
    where coalesce(
        case
          when c.occurred_at ~ '^[0-9]{4}-'
          then c.occurred_at::timestamptz
        end,
        c.opened_at at time zone 'UTC'
      ) >= ${windowStartIso}::timestamptz
      and (
        (
          c.escrow_officer_id is not null
          and exists (
            select 1 from contacts oc
            where oc.id = c.escrow_officer_id
              and oc.email ~* ${EMAIL_SQL}
          )
        )
        or (
          c.escrow_officer_id is null
          and exists (
            select 1 from order_parties ep
            left join contacts epc on epc.id = ep.contact_id
            where ep.order_id = c.order_id
              and ep.role = 'escrow_company'
              and coalesce(ep.external_email, epc.email) ~* ${EMAIL_SQL}
          )
        )
      )
    order by c.opened_at desc nulls last
    limit ${retryLimit}
  `) as unknown as HeldRow[];
  return rows;
}

export async function handleRetryHeldPrelimNoRecipient(
  payload: Record<string, unknown> = {},
): Promise<RetryHeldNoRecipientResult> {
  const limit = parseRetryHeldNoRecipientLimit(payload);
  const windowStart = prelimAutoDeliveryWindowStart();
  const jobId = typeof payload.__jobId === 'number' ? payload.__jobId : null;

  let held: HeldRow[];
  try {
    held = await loadDeliverableHeld(limit, windowStart);
  } catch (err) {
    const pickerError = err instanceof Error ? err.message : String(err);
    const result: RetryHeldNoRecipientResult = {
      limit,
      windowStart: windowStart.toISOString(),
      examined: 0,
      attempted: 0,
      delivered: 0,
      held: [],
      heldByOutcome: {},
      loggedNoEscrowParty: 0,
      rows: [],
      pickerError,
    };
    try {
      await logRun({ jobId, windowStart, result });
    } catch {
      /* the throw below is the record that matters */
    }
    throw err;
  }
  const rows: RetryHeldNoRecipientRow[] = [];
  let attempted = 0;
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

    if (attempted >= limit) break;
    if (attempted > 0) await sleep(RETRY_HELD_NO_RECIPIENT_PAUSE_MS);
    attempted++;

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

  const result: RetryHeldNoRecipientResult = {
    limit,
    windowStart: windowStart.toISOString(),
    examined: held.length,
    attempted,
    delivered: rows.filter((row) => row.sent).length,
    held: rows
      .filter((row) => !row.sent)
      .map((row) => ({
        fileNumber: row.fileNumber,
        outcome: row.outcome,
        reason: row.reason ?? null,
      })),
    heldByOutcome: tally(rows.filter((row) => !row.sent)),
    loggedNoEscrowParty,
    rows,
  };

  try {
    await logRun({ jobId, windowStart, result });
  } catch {
    // The sends already happened. A missing run log must not fail the job.
  }

  return result;
}
