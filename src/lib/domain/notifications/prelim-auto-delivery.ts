import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { adminActivityLogs, orders } from '@/lib/db/schema';
import { getPrelimDeliveryMode } from './prelim-delivery-mode';
import { resolvePrelimRecipients } from './prelim-recipient-resolution';
import { PrelimContentCheckFailedError, sendPrelimDeliveryEmail } from './prelim-delivery-send';

export type PrelimAutoDeliveryOutcome =
  | 'delivered'
  | 'skipped_before_cutoff'
  | 'skipped_already_delivered'
  | 'blocked_no_recipient'
  | 'not_armed'
  | 'delivery_failed'
  /**
   * The document did not read as a preliminary report, so it was NOT sent.
   * Needs a human: never silently skipped, never silently delivered.
   */
  | 'blocked_content_check'
  /**
   * The ORDER arrived by backfill, so its prelim is not news to anyone. Held for
   * a human rather than mailed out. See isBackfilledOrder.
   */
  | 'skipped_backfilled_order';

export interface PrelimAutoDeliveryInput {
  orderId: number;
  documentId: number;
  documentCreatedAt: Date;
  triggeredBy: 'fetch_prelims' | 'softpro_webhook';
}

export interface PrelimAutoDeliveryResult {
  outcome: PrelimAutoDeliveryOutcome;
  sent: boolean;
  needsManualDelivery: boolean;
  reason?: string;
  messageId?: string;
  /**
   * The send succeeded but a proof row did not get written. Carried here and
   * onto the attempt log because the previous version dropped it: the writeback
   * failed 1,082 times, downgraded itself to a `warning` string, and nothing
   * read that string — so `outcome: 'delivered'` was recorded either way.
   */
  writebackWarning?: string;
}

const AUTO_DELIVERY_ACTOR = {
  id: 'system:prelim_auto_delivery',
  name: 'TD Hub Auto Delivery',
  email: 'openorders@pct.com',
};

function parseCutoff(): Date | null {
  const raw = process.env.PRELIM_AUTO_DELIVERY_CUTOFF?.trim();
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * How far our record of an order may lag the real world before the row is an
 * import artifact rather than something the sync saw happen.
 *
 * WHY A LAG AND NOT AN AGE. Age conflates two opposite cases. A file we have
 * held since April whose prelim finally lands in October is a real delivery and
 * must still fire; a row written 40 days after its open date is a backfill and
 * must not mail anyone, whenever its prelim turns up. Only the gap between
 * opened_at and created_at separates them, and it is a property of the ORDER,
 * not of the document — so a late prelim on a long-held file is untouched by
 * this gate.
 *
 * WHY TEN DAYS. Two independent lines agree. Measured: across 5,262 orders
 * opened since 2026-04 and created before the 2026-08-27 recovery, the lag runs
 * p50 0.02d, p95 0.10d, p99 1.98d. Beyond that the tail (p99.9 32.8d, max 42.9d)
 * is prior manual import-orders runs — already the artifact class this catches,
 * not normal operation. Mechanically: the sync requests a trailing
 * SYNC_LOOKBACK_DAYS window, so the hourly path cannot write a row more than
 * that many days after the open date. Ten is that window plus one day for the
 * UTC/Pacific boundary plus two for a run that hits its deadline and resumes.
 * Five times p99, three days clear of the artifact tail.
 */
export const BACKFILL_LAG_THRESHOLD_DAYS = 10;

const DAY_MS = 86_400_000;

/**
 * Whether this order reached us by backfill rather than by seeing it happen.
 *
 * Fails CLOSED — a missing row or a null open date cannot establish the lag, and
 * an order with no open date is already anomalous. Holding a prelim for a human
 * is recoverable; mailing a stale one to an escrow officer is not.
 *
 * KNOWN HOLE. An order whose opened_at defaulted to insert time has a lag near
 * zero and reads as normal here. The 23 such rows from the 2026-08-27 recovery
 * are out of reach only because they are all closed/canceled/duplicate and
 * fetch_prelims takes open/in_process/completed — a property of that batch, not
 * a guarantee. Recording provenance at write time is the durable answer;
 * inferring it from timestamps is what this is.
 */
async function isBackfilledOrder(orderId: number): Promise<{ backfilled: boolean; reason: string }> {
  const [row] = await db
    .select({ openedAt: orders.openedAt, createdAt: orders.createdAt })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!row) {
    return { backfilled: true, reason: `order ${orderId} not found; cannot establish ingest lag` };
  }
  if (!row.openedAt || !row.createdAt) {
    return { backfilled: true, reason: 'order has no open date; cannot establish ingest lag' };
  }

  const lagDays = (row.createdAt.getTime() - row.openedAt.getTime()) / DAY_MS;
  if (lagDays > BACKFILL_LAG_THRESHOLD_DAYS) {
    return {
      backfilled: true,
      reason: `order row written ${lagDays.toFixed(1)}d after its open date `
        + `(threshold ${BACKFILL_LAG_THRESHOLD_DAYS}d) — backfilled, not observed`,
    };
  }

  return { backfilled: false, reason: '' };
}

async function hasExistingPrelimDelivery(input: PrelimAutoDeliveryInput): Promise<boolean> {
  const [existing] = await db
    .select({ id: adminActivityLogs.id })
    .from(adminActivityLogs)
    .where(and(
      eq(adminActivityLogs.entityType, 'order'),
      eq(adminActivityLogs.entityId, String(input.orderId)),
      sql`(
        (${adminActivityLogs.action} = 'prelim_delivered' and (${adminActivityLogs.meta}->>'document_id')::int = ${input.documentId})
        or (
          ${adminActivityLogs.action} = 'prelim_auto_delivery'
          and (${adminActivityLogs.meta}->>'document_id')::int = ${input.documentId}
          and ${adminActivityLogs.meta}->>'outcome' = 'delivered'
        )
      )`,
    ))
    .limit(1);

  return !!existing;
}

async function logAttempt(input: PrelimAutoDeliveryInput, result: PrelimAutoDeliveryResult): Promise<void> {
  await db.insert(adminActivityLogs).values({
    userId: AUTO_DELIVERY_ACTOR.id,
    action: 'prelim_auto_delivery',
    entityType: 'order',
    entityId: String(input.orderId),
    meta: {
      outcome: result.outcome,
      reason: result.reason,
      needs_manual_delivery: result.needsManualDelivery,
      document_id: input.documentId,
      document_created_at: input.documentCreatedAt.toISOString(),
      triggered_by: input.triggeredBy,
      message_id: result.messageId,
      writeback_warning: result.writebackWarning ?? null,
    } as Record<string, unknown>,
  });
}

async function finish(input: PrelimAutoDeliveryInput, result: PrelimAutoDeliveryResult): Promise<PrelimAutoDeliveryResult> {
  await logAttempt(input, result);
  return result;
}

export async function maybeAutoDeliverPrelim(input: PrelimAutoDeliveryInput): Promise<PrelimAutoDeliveryResult> {
  const cutoff = parseCutoff();
  if (!cutoff) {
    return finish(input, {
      outcome: 'skipped_before_cutoff',
      sent: false,
      needsManualDelivery: false,
      reason: 'PRELIM_AUTO_DELIVERY_CUTOFF is not set',
    });
  }

  if (input.documentCreatedAt < cutoff) {
    return finish(input, {
      outcome: 'skipped_before_cutoff',
      sent: false,
      needsManualDelivery: false,
      reason: 'prelim arrived before auto-delivery cutoff',
    });
  }

  if (await hasExistingPrelimDelivery(input)) {
    return finish(input, {
      outcome: 'skipped_already_delivered',
      sent: false,
      needsManualDelivery: false,
      reason: 'prelim document/version already has a delivery marker',
    });
  }

  // Checked after the delivery marker so an already-delivered backfill still
  // reports the more specific outcome, and before recipient resolution so we do
  // not resolve an audience we have already decided not to mail.
  const backfill = await isBackfilledOrder(input.orderId);
  if (backfill.backfilled) {
    return finish(input, {
      outcome: 'skipped_backfilled_order',
      sent: false,
      needsManualDelivery: true,
      reason: backfill.reason,
    });
  }

  const recipients = await resolvePrelimRecipients(input.orderId);
  if (recipients.blocked || !recipients.to) {
    return finish(input, {
      outcome: 'blocked_no_recipient',
      sent: false,
      needsManualDelivery: true,
      reason: recipients.blockReason ?? 'No valid primary prelim recipient resolved',
    });
  }

  const deliveryMode = getPrelimDeliveryMode();
  if (deliveryMode.mode !== 'live') {
    return finish(input, {
      outcome: 'not_armed',
      sent: false,
      needsManualDelivery: false,
      reason: 'prelim auto-delivery requires PRELIM_DELIVERY_LIVE=true',
    });
  }

  try {
    const delivery = await sendPrelimDeliveryEmail(input.orderId, {
      to: recipients.to,
      cc: recipients.cc,
    }, AUTO_DELIVERY_ACTOR, { requirePrelimContent: true });

    return finish(input, {
      outcome: 'delivered',
      sent: true,
      // A proof row that did not get written still needs a human: the client
      // has the prelim, but nothing in the hub says so.
      needsManualDelivery: false,
      messageId: delivery.messageId,
      writebackWarning: delivery.warning,
    });
  } catch (err) {
    // A refused document is not a failed send — it never left. Distinct outcome
    // so the ops panel can tell "the vendor broke" from "we caught a wrong
    // document", which need completely different responses.
    if (err instanceof PrelimContentCheckFailedError) {
      return finish(input, {
        outcome: 'blocked_content_check',
        sent: false,
        needsManualDelivery: true,
        reason: err.message,
      });
    }
    return finish(input, {
      outcome: 'delivery_failed',
      sent: false,
      needsManualDelivery: true,
      reason: err instanceof Error ? err.message : 'Prelim auto-delivery failed',
    });
  }
}
