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
  /** Which proof rows did not get written, and why. Empty on a clean write. */
  failedArtefacts: { artefact: string; message: string; code: string | null }[];
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

/**
 * `order_notes.author_id` is a foreign key onto `profiles`. Auto-delivery's
 * actor is `system:prelim_auto_delivery`, which is not a person and has no
 * profile row, so the insert raised 23503 and took the whole writeback with it
 * — 1,082 times in a row, silently.
 *
 * The column is nullable, so a system-authored note carries a NULL author_id
 * and keeps its human-readable `author_name`. That was chosen over the two
 * alternatives on purpose:
 *
 *   - Dropping the FK would weaken the constraint for the ~human authors it
 *     exists to protect, and the same problem would come back on
 *     `orders.created_by` and `title_production_uploads.uploaded_by`, which
 *     carry the same FK.
 *   - Inventing a profile row would create a login-shaped identity for
 *     something that is not a user, in a table with RLS on it, and would need
 *     a role from an enum that has no honest value for "the system".
 *
 * `admin_activity_logs.user_id` and `document_audit.by_user_id` have no such
 * FK, so they keep the actor string and stay attributable.
 */
function profileAuthorId(actorId: string): string | null {
  return actorId.startsWith('system:') ? null : actorId;
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

  // ─── FOUR ARTEFACTS, WRITTEN INDEPENDENTLY ────────────────────────────────
  //
  // This used to be four bare awaits in a row inside a caller's try/catch. The
  // first one threw on every auto-delivery, so the other three never ran and
  // the error became a `warning` string nobody carried. Result: 1,083 prelims
  // delivered, 1 recorded, and no trace of why.
  //
  // Now each artefact stands or falls alone, and the proof row goes FIRST
  // because it is the one the delivery log reads and the only one with no
  // foreign key to trip over. A failure is recorded, not downgraded.
  //
  // Same rule as create-order's recordCreateLocalFailure: persist the reason.
  const failed: { artefact: string; message: string; code: string | null }[] = [];

  async function write(artefact: string, fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      const e = err as { message?: string; code?: string };
      failed.push({
        artefact,
        message: e?.message ?? String(err),
        code: e?.code ?? null,
      });
    }
  }

  await write('admin_activity_logs', () => db.insert(adminActivityLogs).values({
    userId: input.actor.id,
    action: 'prelim_delivered',
    entityType: 'order',
    entityId: String(input.orderId),
    meta,
    createdAt: deliveredAt,
  }));

  await write('order_notes', () => db.insert(orderNotes).values({
    orderId: input.orderId,
    subject: 'Prelim delivered',
    body: noteText,
    authorName: input.actor.name,
    authorId: profileAuthorId(input.actor.id),
    isInternal: true,
    softproNoteId,
    isSyncedToSoftpro: softproSynced,
    syncedAt: deliveredAt,
    createdAt: deliveredAt,
  }));

  await write('order_status_history', () => db.insert(orderStatusHistory).values({
    orderId: input.orderId,
    status: `Prelim delivered → ${recipientCount} recipients`,
    source: 'system',
    notes: softproSynced
      ? `Delivered ${deliveredAtPt} to ${recipientCount} recipients · SendGrid ${input.sendgridMessageId}; SoftPro note added ${deliveredAtPt} ✓`
      : `Delivered ${deliveredAtPt} to ${recipientCount} recipients · SendGrid ${input.sendgridMessageId}; SoftPro note pending/failed ${deliveredAtPt}`,
    changedAt: deliveredAt,
  }));

  await write('document_audit', () => db.insert(documentAudit).values({
    documentId: input.documentId,
    action: 'delivered',
    byUserId: input.actor.id,
    meta,
    performedAt: deliveredAt,
  }));

  // A failed artefact is a result. Write it where somebody will find it, and
  // never let recording the failure become a second failure.
  if (failed.length > 0) {
    try {
      await db.insert(adminActivityLogs).values({
        userId: input.actor.id,
        action: 'prelim_delivery_writeback_failed',
        entityType: 'order',
        entityId: String(input.orderId),
        meta: {
          failed,
          delivered_artefacts: 4 - failed.length,
          sendgrid_message_id: input.sendgridMessageId,
          document_id: input.documentId,
          delivery_mode: input.deliveryMode.mode,
          actor: input.actor.id,
        },
        createdAt: deliveredAt,
      });
    } catch { /* the email still went out; do not turn this into a 500 */ }
  }

  const writebackWarning = failed.length > 0
    ? `Prelim delivery proof incomplete: ${failed.map((f) => f.artefact).join(', ')} failed`
    : undefined;

  return {
    deliveredAt: deliveredAt.toISOString(),
    deliveredAtPt,
    softproNoteId,
    addNotesRequest,
    addNotesResponse,
    addNotesStatus,
    addNotesMessage,
    softproSynced,
    failedArtefacts: failed,
    // Both conditions matter and they are different failures: SoftPro not
    // taking the note, and our own proof rows not being written.
    warning: [
      writebackWarning,
      softproSynced ? undefined : 'SoftPro note writeback failed or is pending',
    ].filter(Boolean).join(' · ') || undefined,
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
