import { db } from '@/lib/db/client';
import { notificationTypes, notificationLogs, orders, orderProperties, contacts } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { resolveRecipients, type Recipient } from './recipients';
import { sendEmail } from '@/lib/integrations/sendgrid/client';
import { sendSms } from '@/lib/integrations/twilio/client';
import { handleOrderConfirmation } from './order-confirmation';
import {
  orderClosedTemplate,
  milestoneRecordingTemplate,
  milestoneDisbursementTemplate,
  documentReceivedTemplate,
  type OrderEmailData,
} from './templates';

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

// ─── Slug mapping ──────────────────────────────────────────────────────────

function mapEventToSlug(eventType: string, data?: Record<string, unknown>): string {
  if (eventType === 'order.confirmation') return 'order.confirmation';
  if (eventType === 'order.milestone.recording_confirmation') return 'recording.confirmation';
  if (eventType === 'order.milestone.disbursement') return 'funds.disbursed';
  if (eventType === 'order.closed') return 'order.closed';
  if (eventType === 'order.document.received') {
    const cat = (data?.category as string) ?? '';
    if (cat === 'prelim') return 'prelim.summary';
    if (cat === 'policy' || cat === 'supplement') return 'policy.delivery';
    return 'document.ready';
  }
  return eventType;
}

// ─── Order data for template rendering ──────────────────────────────────────

async function loadOrderEmailData(orderId: number): Promise<OrderEmailData> {
  const [row] = await db
    .select({
      fileNumber: orders.fileNumber,
      closedAt: orders.closedAt,
      address: orderProperties.fullAddress,
    })
    .from(orders)
    .leftJoin(orderProperties, eq(orders.id, orderProperties.orderId))
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!row) throw new Error(`Order ${orderId} not found`);
  return {
    fileNumber: row.fileNumber,
    address: row.address,
    closingDate: row.closedAt?.toLocaleDateString('en-US') ?? null,
  };
}

// ─── Main dispatch ──────────────────────────────────────────────────────────

export async function dispatchNotification(params: DispatchParams): Promise<DispatchResult> {
  const { eventType, orderId, data, overrideTo } = params;

  const slug = mapEventToSlug(eventType, data);

  const [notifType] = await db
    .select()
    .from(notificationTypes)
    .where(eq(notificationTypes.slug, slug))
    .limit(1);

  if (!notifType || !notifType.isEnabled) {
    if (notifType) {
      try {
        await insertNotificationLog({
          eventType, orderId, channel: 'skip', status: 'skipped',
          metadata: { reason: 'notification_type_disabled', slug },
        });
      } catch { /* logging failure should not block */ }
    }
    return { sent: 0, failed: 0, skipped: true, logs: [] };
  }

  if (eventType === 'order.confirmation') {
    return handleConfirmationDispatch(orderId, data, overrideTo);
  }

  if (eventType.startsWith('order.milestone.')) {
    return handleMilestoneDispatch(params, notifType);
  }

  if (eventType === 'order.document.received') {
    return handleDocumentDispatch(params, notifType);
  }

  if (eventType === 'order.closed') {
    return handleOrderClosedDispatch(params, notifType);
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
  preResolvedRecipients?: Recipient[],
): Promise<DispatchResult> {
  const { eventType, orderId, data, overrideTo } = params;
  const channels = notifType.channels ?? ['email'];
  const recipients = preResolvedRecipients ?? await resolveRecipients(orderId, notifType.recipientRoles, notifType.internalCc);

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

// ─── Milestone dispatch (recording_confirmation, disbursement) ──────────────

async function handleMilestoneDispatch(
  params: DispatchParams,
  notifType: typeof notificationTypes.$inferSelect,
): Promise<DispatchResult> {
  const milestone = params.eventType.replace('order.milestone.', '');
  const orderData = await loadOrderEmailData(params.orderId);

  const template = milestone === 'disbursement'
    ? milestoneDisbursementTemplate(orderData)
    : milestoneRecordingTemplate(orderData);

  const label = milestone.replace(/_/g, ' ');
  const enrichedData = {
    ...params.data,
    subject: template.subject,
    html: template.html,
    smsBody: `PCT Hub: Order ${orderData.fileNumber} — ${label} confirmed.`,
  };

  const recipients = await resolveRecipients(params.orderId, notifType.recipientRoles, notifType.internalCc);

  const prefField = milestone === 'recording_confirmation'
    ? 'notifyRecordingConfirm' as const
    : milestone === 'disbursement'
      ? 'notifyDisburseFunds' as const
      : null;

  let filtered = recipients;
  if (prefField) {
    const [orderRow] = await db
      .select({ salesRepId: orders.salesRepId })
      .from(orders)
      .where(eq(orders.id, params.orderId))
      .limit(1);

    if (orderRow?.salesRepId) {
      const [rep] = await db
        .select({ pref: contacts[prefField] })
        .from(contacts)
        .where(eq(contacts.id, orderRow.salesRepId))
        .limit(1);

      if (rep && rep.pref === false) {
        filtered = recipients.filter((r) => r.role !== 'sales_rep');
        try {
          await insertNotificationLog({
            eventType: params.eventType,
            orderId: params.orderId,
            channel: 'sms',
            status: 'skipped',
            recipientRole: 'sales_rep',
            metadata: { reason: 'recipient_opted_out', preference: prefField },
          });
        } catch { /* logging must not block */ }
      }
    }
  }

  return handleGenericDispatch({ ...params, data: enrichedData }, notifType, filtered);
}

// ─── Document dispatch ──────────────────────────────────────────────────────

async function handleDocumentDispatch(
  params: DispatchParams,
  notifType: typeof notificationTypes.$inferSelect,
): Promise<DispatchResult> {
  const category = (params.data.category as string) ?? 'general';
  const orderData = await loadOrderEmailData(params.orderId);
  const { subject, html } = documentReceivedTemplate({ ...orderData, category });

  return handleGenericDispatch({
    ...params,
    data: {
      ...params.data,
      subject,
      html,
      smsBody: `PCT Hub: New ${category} document for Order ${orderData.fileNumber}`,
    },
  }, notifType);
}

// ─── Order closed dispatch ──────────────────────────────────────────────────

async function handleOrderClosedDispatch(
  params: DispatchParams,
  notifType: typeof notificationTypes.$inferSelect,
): Promise<DispatchResult> {
  const orderData = await loadOrderEmailData(params.orderId);
  const { subject, html } = orderClosedTemplate(orderData);

  return handleGenericDispatch({
    ...params,
    data: {
      ...params.data,
      subject,
      html,
      smsBody: `PCT Hub: Order ${orderData.fileNumber} has been closed.`,
    },
  }, notifType);
}
