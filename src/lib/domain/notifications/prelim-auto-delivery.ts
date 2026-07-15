import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { adminActivityLogs, orders } from '@/lib/db/schema';
import { getPrelimDeliveryMode } from './prelim-delivery-mode';
import { resolvePrelimRecipients } from './prelim-recipient-resolution';
import { sendPrelimDeliveryEmail } from './prelim-delivery-send';

export type PrelimAutoDeliveryOutcome =
  | 'delivered'
  | 'skipped_before_cutoff'
  | 'skipped_already_delivered'
  | 'blocked_no_recipient'
  | 'not_armed'
  | 'delivery_failed';

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

async function getOrderOpenedAt(orderId: number): Promise<Date | null> {
  const [order] = await db
    .select({ openedAt: orders.openedAt })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  return order?.openedAt ?? null;
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

  const orderOpenedAt = await getOrderOpenedAt(input.orderId);
  if (!orderOpenedAt || orderOpenedAt < cutoff) {
    return finish(input, {
      outcome: 'skipped_before_cutoff',
      sent: false,
      needsManualDelivery: false,
      reason: orderOpenedAt ? 'order opened before auto-delivery cutoff' : 'order opened_at not found',
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
    }, AUTO_DELIVERY_ACTOR);

    return finish(input, {
      outcome: 'delivered',
      sent: true,
      needsManualDelivery: false,
      messageId: delivery.messageId,
    });
  } catch (err) {
    return finish(input, {
      outcome: 'delivery_failed',
      sent: false,
      needsManualDelivery: true,
      reason: err instanceof Error ? err.message : 'Prelim auto-delivery failed',
    });
  }
}
