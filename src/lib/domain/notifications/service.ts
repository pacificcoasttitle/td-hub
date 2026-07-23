import { db } from '@/lib/db/client';
import { eventOutbox, orders, orderProperties, orderParties, contacts } from '@/lib/db/schema';
import { eq, isNull } from 'drizzle-orm';
import { sendEmail } from '@/lib/integrations/sendgrid/client';
import { sendSms } from '@/lib/integrations/twilio/client';
import {
  orderClosedTemplate,
  milestoneRecordingTemplate,
  milestoneDisbursementTemplate,
  documentReceivedTemplate,
  type OrderEmailData,
} from './templates';
import { dispatchNotification } from './dispatch';
import { sweepPendingConfirmations } from '@/lib/domain/titlepoint/completion-checker';

const MAX_FAIL_COUNT = 5;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ProcessOutboxResult {
  processed: number;
  succeeded: number;
  failed: number;
  confirmationSweeps?: { checked: number; enqueued: number };
}

interface NotificationTarget {
  role: string;
  email: string | null;
  name: string | null;
  cell: string | null;
}

interface OrderContext {
  fileNumber: string;
  address: string | null;
  closedAt: Date | null;
  targets: NotificationTarget[];
  salesRep: NotificationTarget | null;
}

// ─── Outbox Processor ───────────────────────────────────────────────────────

export async function processOutboxEvents(): Promise<ProcessOutboxResult> {
  // Timeout/hard-fail fallback: enqueue confirmations that TitlePoint never completed.
  let confirmationSweeps = { checked: 0, enqueued: 0 };
  try {
    confirmationSweeps = await sweepPendingConfirmations();
  } catch { /* sweep must not block outbox drain */ }

  const pending = await db
    .select()
    .from(eventOutbox)
    .where(isNull(eventOutbox.publishedAt))
    .orderBy(eventOutbox.createdAt)
    .limit(50);

  const filtered = pending.filter((e) => e.failCount < MAX_FAIL_COUNT);

  let succeeded = 0;
  let failed = 0;

  for (const event of filtered) {
    try {
      await dispatchEvent(event.eventType, event.orderId, event.payload as Record<string, unknown> | null);
      await db
        .update(eventOutbox)
        .set({ publishedAt: new Date() })
        .where(eq(eventOutbox.id, event.id));
      succeeded++;
    } catch {
      await db
        .update(eventOutbox)
        .set({ failCount: event.failCount + 1 })
        .where(eq(eventOutbox.id, event.id));
      failed++;
    }
  }

  return { processed: filtered.length, succeeded, failed, confirmationSweeps };
}

async function dispatchEvent(
  eventType: string,
  orderId: number | null,
  payload: Record<string, unknown> | null,
): Promise<void> {
  if (!orderId) return;
  await dispatchNotification({ eventType, orderId, data: payload ?? {} });
}

// ─── Load Order Context ─────────────────────────────────────────────────────

async function loadContext(orderId: number): Promise<OrderContext> {
  const orderRow = await db
    .select({
      fileNumber: orders.fileNumber,
      salesRepId: orders.salesRepId,
      closedAt: orders.closedAt,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!orderRow[0]) throw new Error(`Order ${orderId} not found`);
  const { fileNumber, salesRepId, closedAt } = orderRow[0];

  const propRow = await db
    .select({ address: orderProperties.fullAddress })
    .from(orderProperties)
    .where(eq(orderProperties.orderId, orderId))
    .limit(1);

  const address = propRow[0]?.address ?? null;

  const partyRows = await db
    .select({
      role: orderParties.role,
      externalEmail: orderParties.externalEmail,
      externalName: orderParties.externalName,
      contactEmail: contacts.email,
      contactName: contacts.fullName,
      contactCell: contacts.cell,
    })
    .from(orderParties)
    .leftJoin(contacts, eq(orderParties.contactId, contacts.id))
    .where(eq(orderParties.orderId, orderId));

  const targets: NotificationTarget[] = partyRows.map((r) => ({
    role: r.role,
    email: r.contactEmail ?? r.externalEmail ?? null,
    name: r.contactName ?? r.externalName ?? null,
    cell: r.contactCell ?? null,
  }));

  let salesRep: NotificationTarget | null = null;
  if (salesRepId) {
    const rep = await db
      .select({ email: contacts.email, fullName: contacts.fullName, cell: contacts.cell })
      .from(contacts)
      .where(eq(contacts.id, salesRepId))
      .limit(1);
    if (rep[0]) {
      salesRep = { role: 'sales_rep', email: rep[0].email, name: rep[0].fullName, cell: rep[0].cell };
    }
  }

  return { fileNumber, address, closedAt, targets, salesRep };
}

function toEmailData(ctx: OrderContext, dateOverride?: string | null): OrderEmailData {
  const closingDate = dateOverride ?? ctx.closedAt?.toLocaleDateString('en-US') ?? null;
  return { fileNumber: ctx.fileNumber, address: ctx.address, closingDate };
}

function emailsForRoles(targets: NotificationTarget[], roles: string[]): string[] {
  return targets
    .filter((t) => roles.includes(t.role) && t.email)
    .map((t) => t.email!);
}

function dedupe(emails: string[]): string[] {
  return [...new Set(emails)];
}

// ─── DEPRECATED: Old direct-send handlers ───────────────────────────────────
// These functions bypass admin controls (notification_types.isEnabled, channels,
// recipientRoles) and notification_logs. All events now route through
// dispatchNotification() in dispatch.ts. Kept for reference until verified.

/** @deprecated Use dispatchNotification({ eventType: 'order.closed', ... }) */
async function handleOrderClosed(orderId: number): Promise<void> {
  const ctx = await loadContext(orderId);
  const toEmails = emailsForRoles(ctx.targets, ['escrow_company', 'listing_agent', 'buyer_agent']);
  if (ctx.salesRep?.email) toEmails.push(ctx.salesRep.email);

  const recipients = dedupe(toEmails);
  if (recipients.length === 0) return;

  const { subject, html } = orderClosedTemplate(toEmailData(ctx));
  await sendEmail({ to: recipients, subject, html });
}

/** @deprecated Use dispatchNotification({ eventType: 'order.milestone.*', ... }) */
async function handleMilestoneNotification(orderId: number, milestone: string): Promise<void> {
  const ctx = await loadContext(orderId);
  const data = toEmailData(ctx);
  const label = milestone.replace(/_/g, ' ');

  if (ctx.salesRep?.cell) {
    await sendSms({
      to: ctx.salesRep.cell,
      body: `PCT Hub: Order ${ctx.fileNumber} — ${label} confirmed.`,
    });
  }

  const template = milestone === 'disbursement'
    ? milestoneDisbursementTemplate(data)
    : milestoneRecordingTemplate(data);

  const toEmails = emailsForRoles(ctx.targets, ['escrow_company', 'lender']);
  const recipients = dedupe(toEmails);
  if (recipients.length === 0) return;

  await sendEmail({ to: recipients, subject: template.subject, html: template.html });
}

/** @deprecated Use dispatchNotification({ eventType: 'order.document.received', ... }) */
async function handleDocumentReceived(orderId: number, category: string): Promise<void> {
  const ctx = await loadContext(orderId);
  const toEmails = emailsForRoles(ctx.targets, ['escrow_company', 'lender', 'buyer_agent', 'listing_agent']);
  if (ctx.salesRep?.email) toEmails.push(ctx.salesRep.email);

  const recipients = dedupe(toEmails);
  if (recipients.length === 0) return;

  const { subject, html } = documentReceivedTemplate({ ...toEmailData(ctx), category });
  await sendEmail({ to: recipients, subject, html });
}
