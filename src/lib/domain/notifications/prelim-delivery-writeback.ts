import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  adminActivityLogs,
  documentAudit,
  orderNotes,
  orderStatusHistory,
  orders,
} from '@/lib/db/schema';
import { addNotes } from '@/lib/integrations/softpro';
import type { PrelimDeliveryMode } from './prelim-delivery-mode';
import type { ReviewedPrelimRecipients } from './prelim-delivery-send';

interface PrelimDeliveryActor {
  id: string;
  name: string;
  email?: string | null;
}

export interface PrelimDeliveryWritebackInput {
  orderId: number;
  fileNumber: string;
  documentId: number;
  sendgridMessageId: string;
  recipients: ReviewedPrelimRecipients;
  actor: PrelimDeliveryActor;
  deliveryMode: PrelimDeliveryMode;
  deliveredAt?: Date;
}

export interface PrelimDeliveryWritebackResult {
  deliveredAt: string;
  deliveredAtPt: string;
  softproNoteId: string;
  addNotesRequest: Array<{ OrderNumber: string; Text: string; Id: string }>;
  addNotesResponse: unknown;
  addNotesStatus: number | null;
  addNotesMessage: string | null;
  softproSynced: boolean;
  warning?: string;
}

function formatPtTimestamp(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day} ${byType.hour}:${byType.minute} PT`;
}

function recipientLabel(recipient: { name: string | null; role: string }): string {
  return `${recipient.name?.trim() || 'Unknown'} (${recipient.role})`;
}

function buildNoteText(params: {
  deliveredAtPt: string;
  actor: PrelimDeliveryActor;
  recipients: ReviewedPrelimRecipients;
  testMode: boolean;
}): string {
  const to = recipientLabel(params.recipients.to);
  const cc = params.recipients.cc.length > 0
    ? params.recipients.cc.map(recipientLabel).join(', ')
    : 'none';
  const prefix = params.testMode ? '[TEST] ' : '';
  return `${prefix}Prelim delivered via TD Hub on ${params.deliveredAtPt} by ${params.actor.name}. Sent to: ${to}; CC: ${cc}.`;
}

function isSuccessfulAddNotes(item: { Status?: number; Message?: string } | null): boolean {
  return item?.Status === 200 && (item.Message ?? '').toLowerCase().includes('successfully');
}

function firstAddNotesItem(response: unknown): { Status?: number; Message?: string; Id?: string } | null {
  return Array.isArray(response) && response.length > 0
    ? response[0] as { Status?: number; Message?: string; Id?: string }
    : null;
}

function recipientMeta(recipients: ReviewedPrelimRecipients) {
  return [
    { email: recipients.to.email, name: recipients.to.name, role: recipients.to.role, kind: 'to' },
    ...recipients.cc.map((recipient) => ({
      email: recipient.email,
      name: recipient.name,
      role: recipient.role,
      source: recipient.source,
      kind: 'cc',
    })),
  ];
}

export async function writePrelimDeliveryProofs(
  input: PrelimDeliveryWritebackInput,
): Promise<PrelimDeliveryWritebackResult> {
  const deliveredAt = input.deliveredAt ?? new Date();
  const deliveredAtPt = formatPtTimestamp(deliveredAt);
  const softproNoteId = `prelim-delivery-${input.fileNumber}-${deliveredAt.getTime()}`;
  const noteText = buildNoteText({
    deliveredAtPt,
    actor: input.actor,
    recipients: input.recipients,
    testMode: input.deliveryMode.mode === 'test',
  });
  const addNotesRequest = [{
    OrderNumber: input.fileNumber,
    Text: noteText,
    Id: softproNoteId,
  }];

  let addNotesResponse: unknown = null;
  let addNotesStatus: number | null = null;
  let addNotesMessage: string | null = null;

  try {
    const result = await addNotes(input.fileNumber, noteText, softproNoteId);
    addNotesResponse = result.data ?? result.error ?? null;
    const item = firstAddNotesItem(result.data);
    addNotesStatus = item?.Status ?? result.error?.httpStatus ?? null;
    addNotesMessage = item?.Message ?? result.error?.message ?? null;
  } catch (err) {
    addNotesResponse = { error: err instanceof Error ? err.message : 'Unknown AddNotes error' };
    addNotesMessage = err instanceof Error ? err.message : 'Unknown AddNotes error';
  }

  const softproSynced = isSuccessfulAddNotes({ Status: addNotesStatus ?? undefined, Message: addNotesMessage ?? undefined });
  const recipientCount = 1 + input.recipients.cc.length;
  const meta = {
    delivered_at: deliveredAt.toISOString(),
    delivered_at_pt: deliveredAtPt,
    sender: input.actor,
    recipients: recipientMeta(input.recipients),
    recipient_count: recipientCount,
    sendgrid_message_id: input.sendgridMessageId,
    softpro_note_id: softproNoteId,
    addnotes_request: addNotesRequest,
    addnotes_response: addNotesResponse,
    addnotes_status: addNotesStatus,
    addnotes_message: addNotesMessage,
    document_id: input.documentId,
    delivery_mode: input.deliveryMode.mode,
  } as Record<string, unknown>;

  await db.insert(orderNotes).values({
    orderId: input.orderId,
    subject: 'Prelim delivered',
    body: noteText,
    authorName: input.actor.name,
    authorId: input.actor.id,
    softproNoteId,
    isSyncedToSoftpro: softproSynced,
    syncedAt: deliveredAt,
    createdAt: deliveredAt,
  });

  await db.insert(orderStatusHistory).values({
    orderId: input.orderId,
    status: `Prelim delivered → ${recipientCount} recipients`,
    source: 'system',
    notes: softproSynced
      ? `Delivered ${deliveredAtPt} to ${recipientCount} recipients · SendGrid ${input.sendgridMessageId}; SoftPro note added ${deliveredAtPt} ✓`
      : `Delivered ${deliveredAtPt} to ${recipientCount} recipients · SendGrid ${input.sendgridMessageId}; SoftPro note pending/failed ${deliveredAtPt}`,
    changedAt: deliveredAt,
  });

  await db.insert(adminActivityLogs).values({
    userId: input.actor.id,
    action: 'prelim_delivered',
    entityType: 'order',
    entityId: String(input.orderId),
    meta,
    createdAt: deliveredAt,
  });

  await db.insert(documentAudit).values({
    documentId: input.documentId,
    action: 'delivered',
    byUserId: input.actor.id,
    meta,
    performedAt: deliveredAt,
  });

  return {
    deliveredAt: deliveredAt.toISOString(),
    deliveredAtPt,
    softproNoteId,
    addNotesRequest,
    addNotesResponse,
    addNotesStatus,
    addNotesMessage,
    softproSynced,
    warning: softproSynced ? undefined : 'SoftPro note writeback failed or is pending',
  };
}

export async function retryPrelimDeliveryNoteWriteback(noteId: number): Promise<{
  softproNoteId: string | null;
  addNotesStatus: number | null;
  addNotesMessage: string | null;
  softproSynced: boolean;
}> {
  const [note] = await db
    .select({
      id: orderNotes.id,
      orderId: orderNotes.orderId,
      body: orderNotes.body,
      softproNoteId: orderNotes.softproNoteId,
    })
    .from(orderNotes)
    .where(eq(orderNotes.id, noteId))
    .limit(1);

  if (!note?.softproNoteId) {
    throw new Error('Prelim delivery note not found or missing SoftPro note id');
  }

  const [order] = await db
    .select({ fileNumber: orders.fileNumber })
    .from(orders)
    .where(eq(orders.id, note.orderId))
    .limit(1);

  if (!order) throw new Error('Order not found for prelim delivery note retry');

  const result = await addNotes(order.fileNumber, note.body, note.softproNoteId);
  const item = firstAddNotesItem(result.data);
  const addNotesStatus = item?.Status ?? result.error?.httpStatus ?? null;
  const addNotesMessage = item?.Message ?? result.error?.message ?? null;
  const softproSynced = isSuccessfulAddNotes({ Status: addNotesStatus ?? undefined, Message: addNotesMessage ?? undefined });

  await db.update(orderNotes).set({
    isSyncedToSoftpro: softproSynced,
    syncedAt: new Date(),
  }).where(eq(orderNotes.id, note.id));

  return {
    softproNoteId: note.softproNoteId,
    addNotesStatus,
    addNotesMessage,
    softproSynced,
  };
}
