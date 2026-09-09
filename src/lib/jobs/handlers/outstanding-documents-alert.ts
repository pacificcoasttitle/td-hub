/**
 * Scan recent confirmations for documents the customer never received.
 *
 * Runs every two minutes. The decision rules live in
 * `@/lib/domain/notifications/outstanding-documents-alert` and are pure; this
 * file is the plumbing that feeds them and sends the result.
 *
 * ─── WHAT THIS READS, AND WHY IT ONLY WORKS GOING FORWARD ───────────────────
 *
 * "What did the confirmation carry" comes from `notification_logs.metadata`,
 * which was null on all 961 sends before it was captured. Rows without it are
 * skipped rather than guessed at — inferring from document timestamps is the
 * inference that cannot tell "never generated" from "generated and dropped",
 * which is the whole reason the record was added. A confirmation sent before
 * that shipped simply cannot be alerted on, and that is the honest answer.
 */

import { and, eq, gt, inArray, isNotNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { documents, notificationLogs, orderProperties, orders } from '@/lib/db/schema';
import { dispatchNotification } from '@/lib/domain/notifications/dispatch';
import { CONFIRMATION_DOC_TYPES } from '@/lib/domain/notifications/confirmation-documents';
import {
  OUTSTANDING_ALERT_EVENT_TYPE,
  OUTSTANDING_ALERT_SCAN_WINDOW_HOURS,
  buildOutstandingAlertEmail,
  decideOutstandingAlert,
  missingFromConfirmation,
} from '@/lib/domain/notifications/outstanding-documents-alert';

/** Bounds a single run. Steady state is under one alert per day. */
const MAX_ORDERS_PER_RUN = 25;

export interface OutstandingAlertRunResult {
  scanned: number;
  alerted: number;
  waiting: number;
  skippedNoMetadata: number;
  failed: number;
}

interface ConfirmationRow {
  orderId: number;
  sentAt: Date;
  attached: string[];
  clientName: string | null;
  clientEmail: string | null;
}

function readConfirmationMetadata(value: unknown): {
  attached: string[];
  clientName: string | null;
  clientEmail: string | null;
} | null {
  if (!value || typeof value !== 'object') return null;
  const meta = value as Record<string, unknown>;
  if (!Array.isArray(meta.attached)) return null;
  return {
    attached: meta.attached.filter((c): c is string => typeof c === 'string'),
    clientName: typeof meta.clientName === 'string' ? meta.clientName : null,
    clientEmail: typeof meta.clientEmail === 'string' ? meta.clientEmail : null,
  };
}

export async function handleOutstandingDocumentsAlert(): Promise<OutstandingAlertRunResult> {
  const result: OutstandingAlertRunResult = {
    scanned: 0,
    alerted: 0,
    waiting: 0,
    skippedNoMetadata: 0,
    failed: 0,
  };

  const since = new Date(Date.now() - OUTSTANDING_ALERT_SCAN_WINDOW_HOURS * 60 * 60 * 1000);

  /*
    One row per order, earliest send. A confirmation writes one log row per
    recipient, so without the DISTINCT ON an order with four recipients would
    be considered four times in a single run.

    NOT EXISTS on our own event type is the dedupe: dispatchNotification writes
    a log row per recipient with event_type = the slug, so a delivered alert
    excludes its order from every later scan. An alert that resolved zero
    recipients writes nothing and will be retried — until the order falls out
    of the scan window, which is what stops that being forever.

    ─── TWO THINGS HERE ARE LOAD-BEARING, AND BOTH ARE ABOUT STARVATION ──────

    `metadata IS NOT NULL` is a filter, not an optimisation. Confirmations sent
    before the send record shipped can never be alerted on, and there are
    hundreds of them inside any 24-hour window at cutover. Left in, they fill
    MAX_ORDERS_PER_RUN with rows that can only be skipped, and a real alert
    waits behind them until they age out.

    The outer ORDER BY sent_at DESC is the same concern. DISTINCT ON forces the
    inner sort to lead with order_id, which is effectively oldest-first; without
    re-sorting, a backlog would always be worked from the wrong end. Newest
    first is right for an alert whose value decays.
  */
  const rows = await db.execute<{
    order_id: number;
    sent_at: Date;
    metadata: unknown;
  }>(sql`
    SELECT * FROM (
      SELECT DISTINCT ON (nl.order_id)
        nl.order_id,
        nl.sent_at,
        nl.metadata
      FROM ${notificationLogs} nl
      WHERE nl.event_type = 'order.confirmation'
        AND nl.status IN ('sent', 'sent_no_client')
        AND nl.sent_at IS NOT NULL
        AND nl.sent_at > ${since}
        AND nl.metadata IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM ${notificationLogs} prior
          WHERE prior.order_id = nl.order_id
            AND prior.event_type = ${OUTSTANDING_ALERT_EVENT_TYPE}
        )
      ORDER BY nl.order_id, nl.sent_at ASC
    ) c
    ORDER BY c.sent_at DESC
    LIMIT ${MAX_ORDERS_PER_RUN}
  `);

  const candidates: ConfirmationRow[] = [];
  for (const row of rows) {
    result.scanned++;
    const meta = readConfirmationMetadata(row.metadata);
    if (!meta) {
      result.skippedNoMetadata++;
      continue;
    }
    if (missingFromConfirmation(meta.attached).length === 0) continue;
    candidates.push({
      orderId: row.order_id,
      sentAt: new Date(row.sent_at),
      attached: meta.attached,
      clientName: meta.clientName,
      clientEmail: meta.clientEmail,
    });
  }

  if (candidates.length === 0) return result;

  const orderIds = candidates.map((c) => c.orderId);

  const presentRows = await db
    .select({ orderId: documents.orderId, category: documents.category })
    .from(documents)
    .where(and(
      inArray(documents.orderId, orderIds),
      inArray(documents.category, [...CONFIRMATION_DOC_TYPES]),
      eq(documents.status, 'active'),
    ));

  const presentByOrder = new Map<number, string[]>();
  for (const row of presentRows) {
    const list = presentByOrder.get(row.orderId) ?? [];
    list.push(row.category);
    presentByOrder.set(row.orderId, list);
  }

  const orderRows = await db
    .select({
      id: orders.id,
      fileNumber: orders.fileNumber,
      address: orderProperties.fullAddress,
    })
    .from(orders)
    .leftJoin(orderProperties, eq(orders.id, orderProperties.orderId))
    .where(inArray(orders.id, orderIds));

  const orderById = new Map(orderRows.map((o) => [o.id, o]));

  for (const candidate of candidates) {
    const order = orderById.get(candidate.orderId);
    if (!order) continue;

    const decision = decideOutstandingAlert({
      missingAtSend: missingFromConfirmation(candidate.attached),
      presentNow: presentByOrder.get(candidate.orderId) ?? [],
      minutesSinceSend: (Date.now() - candidate.sentAt.getTime()) / 60_000,
    });

    if (!decision.fire) {
      result.waiting++;
      continue;
    }

    const { subject, html } = buildOutstandingAlertEmail({
      orderId: candidate.orderId,
      fileNumber: order.fileNumber,
      address: order.address,
      clientName: candidate.clientName,
      clientEmail: candidate.clientEmail,
      decision,
      sentAt: candidate.sentAt,
    });

    try {
      const dispatched = await dispatchNotification({
        eventType: OUTSTANDING_ALERT_EVENT_TYPE,
        orderId: candidate.orderId,
        data: {
          subject,
          html,
          reason: decision.reason,
          available: decision.available,
          neverCame: decision.neverCame,
        },
      });
      if (dispatched.sent > 0) result.alerted++;
      else result.failed++;
    } catch {
      // One order's failure must not stop the rest of the scan. The order stays
      // undeduped and is retried on the next run.
      result.failed++;
    }
  }

  return result;
}

/** Read-only counterpart for scripts and the ops panel. */
export async function countPendingOutstandingAlerts(): Promise<number> {
  const since = new Date(Date.now() - OUTSTANDING_ALERT_SCAN_WINDOW_HOURS * 60 * 60 * 1000);
  const [row] = await db
    .select({ n: sql<number>`count(DISTINCT ${notificationLogs.orderId})::int` })
    .from(notificationLogs)
    .where(and(
      eq(notificationLogs.eventType, 'order.confirmation'),
      isNotNull(notificationLogs.metadata),
      gt(notificationLogs.sentAt, since),
    ));
  return row?.n ?? 0;
}
