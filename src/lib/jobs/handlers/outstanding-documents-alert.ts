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
 *
 * ─── WHEN THE SEARCH STARTS AFTER THE CONFIRMATION ──────────────────────────
 *
 * The 24-hour window, the two-hour wait, and the once-only latch all restart
 * from the first title search that begins after the confirmation. Without
 * that, an order whose search starts after send ages out — or already fired
 * `never_arrived` — and the documents land with nobody told. That is the
 * seven-order case. `alertClock` is the rule; this query feeds it.
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { documents, notificationLogs, orderProperties, orders, titlePointData } from '@/lib/db/schema';
import { dispatchNotification } from '@/lib/domain/notifications/dispatch';
import { CONFIRMATION_DOC_TYPES } from '@/lib/domain/notifications/confirmation-documents';
import {
  OUTSTANDING_ALERT_EVENT_TYPE,
  OUTSTANDING_ALERT_SCAN_WINDOW_HOURS,
  alertClock,
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

/**
 * `min()` over jsonb has no operator class, so the record is aggregated as
 * text and parsed back. One row per order is the reason an aggregate is needed
 * at all, and every recipient row of one send carries the identical record —
 * so "the minimum" here is just "the one".
 */
function parseMetadata(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
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

interface CandidateSqlRow {
  order_id: number;
  first_sent_at: string;
  send_record: string | null;
  first_search_after: string | null;
  last_alert_at: string | null;
}

export async function handleOutstandingDocumentsAlert(): Promise<OutstandingAlertRunResult> {
  const result: OutstandingAlertRunResult = {
    scanned: 0,
    alerted: 0,
    waiting: 0,
    skippedNoMetadata: 0,
    failed: 0,
  };

  // A STRING, not a Date. A Date interpolated into raw `sql` is rejected by the
  // driver before the query runs (src/lib/db/driver-bind.ts). This exact defect
  // was fixed in #110 and reintroduced by #139; the query then failed on every
  // run for 14 hours. driver-bind.test.ts binds this query the way production
  // does, so a Date here fails the build instead.
  const since = new Date(Date.now() - OUTSTANDING_ALERT_SCAN_WINDOW_HOURS * 60 * 60 * 1000).toISOString();

  /*
    One row per order. A confirmation writes one log row per recipient, so
    without the grouping an order with four recipients is considered four
    times in a single run.

    The window and the once-only latch are both on `alertClock().anchor`,
    not on the confirmation send. A title search that starts after send
    restarts all three clocks from that search.

    `metadata IS NOT NULL` is a filter, not an optimisation. Confirmations sent
    before the send record shipped can never be alerted on, and a 24-hour
    window held hundreds of them at cutover. Left in, they fill
    MAX_ORDERS_PER_RUN with rows that can only be skipped and a real alert
    waits behind them until they age out.

    Ordering by the clock DESCENDING is the same concern from the other
    end: a backlog must be worked newest-first, because this alert's value
    decays and the oldest entries are the least recoverable.

    ALIASED ON PURPOSE. Both confirmation aggregates render as bare `min(...)`,
    so Postgres returns two columns both called "min" and the second silently
    overwrites the first in a name-keyed row. The sent time would come back
    holding the metadata text, and every order would look like it had just
    been sent. Caught by executing the generated SQL, not by reading it.
  */
  const rows = await db.execute(sql`
    with confirms as (
      select
        order_id,
        min(sent_at) as first_sent_at,
        min(metadata::text) as send_record
      from notification_logs
      where event_type = 'order.confirmation'
        and status in ('sent', 'sent_no_client')
        and order_id is not null
        and sent_at is not null
        and metadata is not null
      group by order_id
    ),
    searches as (
      select t.order_id, min(t.created_at) as first_search_after
      from title_point_data t
      join confirms c on c.order_id = t.order_id
      where t.created_at > c.first_sent_at
      group by t.order_id
    ),
    last_alert as (
      select order_id, max(sent_at) as last_alert_at
      from notification_logs
      where event_type = ${OUTSTANDING_ALERT_EVENT_TYPE}
      group by order_id
    )
    select
      c.order_id,
      c.first_sent_at,
      c.send_record,
      s.first_search_after,
      a.last_alert_at
    from confirms c
    left join searches s on s.order_id = c.order_id
    left join last_alert a on a.order_id = c.order_id
    where (
        c.first_sent_at > ${since}
        or s.first_search_after > ${since}
      )
      and (
        a.last_alert_at is null
        or (s.first_search_after is not null and s.first_search_after > a.last_alert_at)
      )
    order by coalesce(s.first_search_after, c.first_sent_at) desc
    limit ${MAX_ORDERS_PER_RUN}
  `) as unknown as CandidateSqlRow[];

  const candidates: ConfirmationRow[] = [];
  for (const row of rows) {
    result.scanned++;
    if (row.order_id == null || row.first_sent_at == null) continue;
    const meta = readConfirmationMetadata(parseMetadata(row.send_record));
    if (!meta) {
      result.skippedNoMetadata++;
      continue;
    }
    if (missingFromConfirmation(meta.attached).length === 0) continue;
    candidates.push({
      orderId: row.order_id,
      sentAt: new Date(row.first_sent_at),
      attached: meta.attached,
      clientName: meta.clientName,
      clientEmail: meta.clientEmail,
    });
  }

  if (candidates.length === 0) return result;

  const orderIds = candidates.map((c) => c.orderId);

  const [presentRows, searchRows, alertRows, orderRows] = await Promise.all([
    db
      .select({ orderId: documents.orderId, category: documents.category })
      .from(documents)
      .where(and(
        inArray(documents.orderId, orderIds),
        inArray(documents.category, [...CONFIRMATION_DOC_TYPES]),
        eq(documents.status, 'active'),
      )),
    db
      .select({ orderId: titlePointData.orderId, createdAt: titlePointData.createdAt })
      .from(titlePointData)
      .where(inArray(titlePointData.orderId, orderIds)),
    db
      .select({
        orderId: notificationLogs.orderId,
        sentAt: notificationLogs.sentAt,
      })
      .from(notificationLogs)
      .where(and(
        inArray(notificationLogs.orderId, orderIds),
        eq(notificationLogs.eventType, OUTSTANDING_ALERT_EVENT_TYPE),
      )),
    db
      .select({
        id: orders.id,
        fileNumber: orders.fileNumber,
        address: orderProperties.fullAddress,
      })
      .from(orders)
      .leftJoin(orderProperties, eq(orders.id, orderProperties.orderId))
      .where(inArray(orders.id, orderIds)),
  ]);

  const presentByOrder = new Map<number, string[]>();
  for (const row of presentRows) {
    const list = presentByOrder.get(row.orderId) ?? [];
    list.push(row.category);
    presentByOrder.set(row.orderId, list);
  }

  const searchesByOrder = new Map<number, Date[]>();
  for (const row of searchRows) {
    if (row.orderId == null) continue;
    const list = searchesByOrder.get(row.orderId) ?? [];
    list.push(row.createdAt);
    searchesByOrder.set(row.orderId, list);
  }

  const lastAlertByOrder = new Map<number, Date>();
  for (const row of alertRows) {
    if (row.orderId == null || row.sentAt == null) continue;
    const prev = lastAlertByOrder.get(row.orderId);
    if (!prev || row.sentAt > prev) lastAlertByOrder.set(row.orderId, row.sentAt);
  }

  const orderById = new Map(orderRows.map((o) => [o.id, o]));
  const now = Date.now();
  const windowMs = OUTSTANDING_ALERT_SCAN_WINDOW_HOURS * 60 * 60 * 1000;

  for (const candidate of candidates) {
    const order = orderById.get(candidate.orderId);
    if (!order) continue;

    const clock = alertClock({
      confirmationSentAt: candidate.sentAt,
      searchStartedAts: searchesByOrder.get(candidate.orderId) ?? [],
      lastAlertAt: lastAlertByOrder.get(candidate.orderId) ?? null,
    });

    if (clock.priorAlertCounts) continue;
    if (now - clock.anchor.getTime() > windowMs) continue;

    const decision = decideOutstandingAlert({
      missingAtSend: missingFromConfirmation(candidate.attached),
      presentNow: presentByOrder.get(candidate.orderId) ?? [],
      minutesSinceSend: (now - clock.anchor.getTime()) / 60_000,
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
          restartedFromSearch: clock.restartedFromSearch,
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
  // A string, not a Date — see handleOutstandingDocumentsAlert.
  const since = new Date(Date.now() - OUTSTANDING_ALERT_SCAN_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
  const [row] = await db.execute(sql`
    select count(*)::int as n
    from (
      select c.order_id
      from (
        select order_id, min(sent_at) as first_sent_at
        from notification_logs
        where event_type = 'order.confirmation'
          and metadata is not null
          and order_id is not null
        group by order_id
      ) c
      left join (
        select t.order_id, min(t.created_at) as first_search_after
        from title_point_data t
        join (
          select order_id, min(sent_at) as first_sent_at
          from notification_logs
          where event_type = 'order.confirmation'
          group by order_id
        ) conf on conf.order_id = t.order_id
        where t.created_at > conf.first_sent_at
        group by t.order_id
      ) s on s.order_id = c.order_id
      where c.first_sent_at > ${since}
         or s.first_search_after > ${since}
    ) q
  `) as unknown as Array<{ n: number }>;
  return row?.n ?? 0;
}
