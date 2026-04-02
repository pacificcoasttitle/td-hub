import { db } from '@/lib/db/client';
import { notificationTypes, notificationLogs } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { resolveRecipients, type Recipient } from './recipients';
import { sendEmail } from '@/lib/integrations/sendgrid/client';
import { sendSms } from '@/lib/integrations/twilio/client';
import { handleOrderConfirmation } from './order-confirmation';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DispatchParams {
  eventType: string;
  orderId: number;
  data: Record<string, unknown>;
  overrideTo?: string;
}

export interface NotificationLogEntry {
  id: number;
  eventType: string;
  channel: string;
  recipientEmail: string | null;
  recipientPhone: string | null;
  status: string;
}

export interface DispatchResult {
  sent: number;
  failed: number;
  skipped: boolean;
  logs: NotificationLogEntry[];
}

// ─── Log helper ─────────────────────────────────────────────────────────────

export async function insertNotificationLog(entry: {
  eventType: string;
  orderId: number;
  channel: string;
  recipientEmail?: string | null;
  recipientPhone?: string | null;
  recipientName?: string | null;
  recipientRole?: string | null;
  subject?: string | null;
  templateUsed?: string | null;
  status: string;
  provider?: string | null;
  providerId?: string | null;
  errorMessage?: string | null;
  metadata?: Record<string, unknown> | null;
  sentAt?: Date | null;
}): Promise<number> {
  const [row] = await db.insert(notificationLogs).values({
    eventType: entry.eventType,
    orderId: entry.orderId,
    channel: entry.channel,
    recipientEmail: entry.recipientEmail ?? null,
    recipientPhone: entry.recipientPhone ?? null,
    recipientName: entry.recipientName ?? null,
    recipientRole: entry.recipientRole ?? null,
    subject: entry.subject ?? null,
    templateUsed: entry.templateUsed ?? null,
    status: entry.status,
    provider: entry.provider ?? null,
    providerId: entry.providerId ?? null,
    errorMessage: entry.errorMessage ?? null,
    metadata: entry.metadata ?? null,
    sentAt: entry.sentAt ?? null,
  }).returning({ id: notificationLogs.id });
  return row.id;
}

// ─── Main dispatch ──────────────────────────────────────────────────────────

export async function dispatchNotification(params: DispatchParams): Promise<DispatchResult> {
  const { eventType, orderId, data, overrideTo } = params;

  const [notifType] = await db
    .select()
    .from(notificationTypes)
    .where(eq(notificationTypes.slug, eventType))
    .limit(1);

  if (!notifType || !notifType.isEnabled) {
    if (notifType) {
      try {
        await insertNotificationLog({
          eventType, orderId, channel: 'skip', status: 'skipped',
          metadata: { reason: 'notification_type_disabled' },
        });
      } catch { /* logging failure should not block */ }
    }
    return { sent: 0, failed: 0, skipped: true, logs: [] };
  }

  if (eventType === 'order.confirmation') {
    return handleConfirmationDispatch(orderId, data, overrideTo);
  }

  return handleGenericDispatch(params, notifType);
}

// ─── Order confirmation (delegates to existing pipeline) ────────────────────

async function handleConfirmationDispatch(
  orderId: number,
  data: Record<string, unknown>,
  overrideTo?: string,
): Promise<DispatchResult> {
  const payload: Record<string, unknown> = { ...data };
  if (overrideTo) payload.testOverrideTo = overrideTo;

  await handleOrderConfirmation(orderId, payload);

  return { sent: 1, failed: 0, skipped: false, logs: [] };
}

// ─── Generic dispatch for all other event types ─────────────────────────────

async function handleGenericDispatch(
  params: DispatchParams,
  notifType: typeof notificationTypes.$inferSelect,
): Promise<DispatchResult> {
  const { eventType, orderId, data, overrideTo } = params;
  const channels = notifType.channels ?? ['email'];
  const recipients = await resolveRecipients(orderId, notifType.recipientRoles, notifType.internalCc);

  if (recipients.length === 0 && !overrideTo) {
    return { sent: 0, failed: 0, skipped: false, logs: [] };
  }

  const subject = (data.subject as string) ?? `${notifType.displayName} — Order Update`;
  const html = (data.html as string) ?? `<p>${notifType.description ?? notifType.displayName}</p>`;
  const smsBody = (data.smsBody as string) ?? `PCT Hub: ${notifType.displayName}`;

  const logs: NotificationLogEntry[] = [];
  let sent = 0;
  let failed = 0;

  for (const channel of channels) {
    const targets: Recipient[] = overrideTo
      ? [{ role: 'override', name: null, email: overrideTo, phone: overrideTo }]
      : recipients;

    for (const recipient of targets) {
      if (channel === 'email' && recipient.email) {
        const result = await sendEmail({ to: recipient.email, subject, html });
        const status = result.success ? 'sent' : 'failed';

        try {
          const logId = await insertNotificationLog({
            eventType, orderId, channel: 'email',
            recipientEmail: recipient.email,
            recipientName: recipient.name,
            recipientRole: recipient.role,
            subject,
            templateUsed: notifType.templateId,
            status,
            provider: 'sendgrid',
            providerId: result.data?.messageId ?? null,
            errorMessage: result.error?.message ?? null,
            sentAt: result.success ? new Date() : null,
          });
          logs.push({ id: logId, eventType, channel: 'email', recipientEmail: recipient.email, recipientPhone: null, status });
        } catch { /* logging failure should not block */ }

        if (result.success) sent++; else failed++;
      }

      if (channel === 'sms' && recipient.phone) {
        const result = await sendSms({ to: recipient.phone, body: smsBody });
        const status = result.success ? 'sent' : 'failed';

        try {
          const logId = await insertNotificationLog({
            eventType, orderId, channel: 'sms',
            recipientPhone: recipient.phone,
            recipientName: recipient.name,
            recipientRole: recipient.role,
            status,
            provider: 'twilio',
            providerId: result.data?.messageSid ?? null,
            errorMessage: result.error?.message ?? null,
            sentAt: result.success ? new Date() : null,
          });
          logs.push({ id: logId, eventType, channel: 'sms', recipientEmail: null, recipientPhone: recipient.phone, status });
        } catch { /* logging failure should not block */ }

        if (result.success) sent++; else failed++;
      }
    }
  }

  return { sent, failed, skipped: false, logs };
}
