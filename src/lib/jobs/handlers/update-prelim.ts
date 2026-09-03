/**
 * Request Updated Prelim — the SoftPro half, run in the background.
 *
 * Order matters and is not legacy's. Legacy ran
 *   note → task → local note → S3 → doc row → SoftPro upload → email
 * which opens the task before the document exists, so a failed upload left a
 * human looking at a task for a prelim that was never attached.
 *
 * Here: the PDF is already stored (the route did that) →
 *   attach to SoftPro → verify the attach → add the note → open the task → email.
 *
 * The task is the signal to a person that work is ready, so it goes last and
 * only if everything before it succeeded. Every step's real result is recorded;
 * nothing writes a hard-coded success.
 */

import { eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { documentAudit, documents, orders } from '@/lib/db/schema';
import { attachToSoftPro } from '@/lib/domain/documents/service';
import {
  SOFTPRO_ACCEPTED_NOT_CONFIRMED_COPY,
  type SoftProAttachVerifyState,
} from '@/lib/domain/documents/softpro-attach-verify';
import { softProDocumentName } from '@/lib/domain/documents/softpro-document-name';
import { attachedNamesFromGetAttached } from '@/lib/domain/documents/softpro-folder';
import { dispatchNotification } from '@/lib/domain/notifications/dispatch';
import {
  UPDATE_PRELIM_FOLDER_NAME,
  UPDATE_PRELIM_TASK_ID,
  buildPrelimNoteText,
  supersedePriorPrelims,
  type UpdatePrelimJobPayload,
} from '@/lib/domain/prelim/update-prelim';
import { addNotes, addTask, getAttachedDocumentsPrelim } from '@/lib/integrations/softpro';

export interface UpdatePrelimStepResult {
  ok: boolean;
  detail: string | null;
}

/**
 * Per-step progress, persisted onto the job row after each step succeeds.
 *
 * A retry re-runs the whole handler, and AddNotes is not idempotent — a second
 * attempt after a failed task would leave two identical notes on the file.
 * That is the duplicate shape that cost us seven orders, so each step is
 * skipped once it has been recorded as done.
 */
export interface UpdatePrelimProgress {
  attached?: boolean;
  /** Terminal verify state once decided. Absent means the listing was not read yet. */
  verifyState?: SoftProAttachVerifyState;
  noted?: boolean;
  tasked?: boolean;
  emailed?: boolean;
  supersededCount?: number;
}

function parseProgress(raw: unknown): UpdatePrelimProgress {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const state = r.verifyState;
  return {
    attached: r.attached === true,
    verifyState: state === 'confirmed' || state === 'accepted' || state === 'failed'
      ? state
      : undefined,
    noted: r.noted === true,
    tasked: r.tasked === true,
    emailed: r.emailed === true,
    supersededCount: typeof r.supersededCount === 'number' ? r.supersededCount : undefined,
  };
}

/** Merge progress onto the job row so a retry can resume instead of repeating. */
async function saveProgress(
  jobId: number | null,
  progress: UpdatePrelimProgress,
): Promise<void> {
  if (jobId === null) return;
  try {
    await db.execute(sql`
      UPDATE jobs
      SET payload = coalesce(payload, '{}'::jsonb)
        || jsonb_build_object('progress', ${JSON.stringify(progress)}::jsonb)
      WHERE id = ${jobId}
    `);
  } catch {
    // Losing progress means a retry may repeat a step; it must not fail the run.
  }
}

export interface UpdatePrelimRunResult {
  documentId: number;
  orderNumber: string;
  attach: UpdatePrelimStepResult;
  /**
   * 'confirmed' — GetAttachedDocumentsPrelim returned the name we sent.
   * 'accepted'  — SoftPro took the write but the listing did not show it.
   *
   * Deliberately not one boolean and not one word. Both open the task, but if
   * someone reports a prelim missing later, this is the difference between
   * "we watched it land" and "we heard a 200". Collapsing them throws away the
   * only evidence that answers that question.
   */
  verifyState: SoftProAttachVerifyState;
  note: UpdatePrelimStepResult;
  task: UpdatePrelimStepResult;
  email: UpdatePrelimStepResult;
  supersededCount: number;
}

function step(ok: boolean, detail: string | null = null): UpdatePrelimStepResult {
  return { ok, detail };
}

function parsePayload(raw: Record<string, unknown>): UpdatePrelimJobPayload {
  const documentId = Number(raw.documentId);
  const orderId = Number(raw.orderId);
  const orderNumber = typeof raw.orderNumber === 'string' ? raw.orderNumber : '';
  if (!Number.isInteger(documentId) || documentId <= 0) {
    throw new Error('update-prelim: payload.documentId missing or invalid');
  }
  if (!Number.isInteger(orderId) || orderId <= 0) {
    throw new Error('update-prelim: payload.orderId missing or invalid');
  }
  if (!orderNumber) {
    throw new Error('update-prelim: payload.orderNumber missing');
  }
  return {
    documentId,
    orderId,
    orderNumber,
    subject: typeof raw.subject === 'string' ? raw.subject : '',
    note: typeof raw.note === 'string' ? raw.note : '',
    requestedBy: typeof raw.requestedBy === 'string' ? raw.requestedBy : 'unknown',
  };
}

/**
 * Prelim-specific listing check.
 *
 * GetAttachedDocuments cannot see Production Documents subfolders — 200 on
 * write then an empty list, open with the vendor
 * (SOFTPRO_GETATTACHED_MISSES_PRODUCTION_FOLDERS). GetAttachedDocumentsPrelim
 * is the prelim slice and does return prelims, so it is the listing we trust
 * for this document type.
 *
 * A false here means "write-accepted, listing did not show it" — that is the
 * accepted state, not failure. It does not stop the flow, because refusing to
 * open the task on a listing we know to be incomplete would mean prelims
 * SoftPro genuinely filed never reached a human.
 */
async function confirmPrelimListed(
  orderNumber: string,
  documentName: string,
): Promise<{ confirmed: boolean; detail: string }> {
  const listed = await getAttachedDocumentsPrelim(orderNumber);
  if (!listed.success) {
    return {
      confirmed: false,
      detail: `GetAttachedDocumentsPrelim failed: ${listed.error?.message ?? 'unknown'}`,
    };
  }

  const names = attachedNamesFromGetAttached(listed.data);
  const confirmed = names.some((n) => n.toLowerCase() === documentName.toLowerCase());

  return {
    confirmed,
    detail: confirmed
      ? `listed as ${documentName}`
      : `not on prelim listing (${names.length} prelim name(s) returned)`,
  };
}

export async function handleUpdatePrelim(
  raw: Record<string, unknown>,
): Promise<UpdatePrelimRunResult> {
  const payload = parsePayload(raw);
  const { documentId, orderId, orderNumber } = payload;

  const [doc] = await db
    .select({
      id: documents.id,
      orderId: documents.orderId,
      category: documents.category,
      status: documents.status,
      filename: documents.filename,
    })
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);

  if (!doc) throw new Error(`update-prelim: document ${documentId} not found`);
  if (doc.orderId !== orderId) {
    throw new Error(`update-prelim: document ${documentId} does not belong to order ${orderId}`);
  }
  if (doc.status !== 'active') {
    throw new Error(`update-prelim: document ${documentId} is ${doc.status}`);
  }

  const documentName = softProDocumentName({
    documentId,
    category: doc.category,
    filename: doc.filename,
  });

  const jobId = typeof raw.__jobId === 'number' ? raw.__jobId : null;
  const progress = parseProgress(raw.progress);

  // 1 — attach. attachToSoftPro builds the short fetch-doc FileURL (never a
  // presigned S3 URL: at ~440 chars those fail the Windows 260-char MAX_PATH
  // before Path.GetFileName ever chokes on the query string), posts
  // AddDocuments, and classifies accepted vs confirmed vs failed.
  if (!progress.attached) {
    const attach = await attachToSoftPro(documentId, UPDATE_PRELIM_FOLDER_NAME);
    if (!attach.success) {
      // No note, no task, no email. Nobody is told there is work to do.
      throw new Error(`update-prelim: SoftPro attach failed: ${attach.error ?? 'unknown'}`);
    }
    progress.attached = true;
    await saveProgress(jobId, progress);
  }

  // 2 — verify against the prelim listing. Records WHICH of the two states we
  // ended in, not merely whether we got the good one.
  let verifyDetail = `listing already read: ${progress.verifyState}`;
  if (!progress.verifyState) {
    const verify = await confirmPrelimListed(orderNumber, documentName);
    verifyDetail = verify.detail;
    progress.verifyState = verify.confirmed ? 'confirmed' : 'accepted';

    await db
      .update(documents)
      .set({
        softproListingConfirmed: verify.confirmed,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, documentId));

    // The evidence, kept where a later "where did our prelim go?" will look.
    await db.insert(documentAudit).values({
      documentId,
      action: 'attached_to_softpro',
      meta: {
        source: 'update_prelim',
        orderNumber,
        documentName,
        verifyState: progress.verifyState,
        listing: 'GetAttachedDocumentsPrelim',
        listingDetail: verify.detail,
      } as Record<string, unknown>,
    });

    await saveProgress(jobId, progress);
  }

  // The new prelim is filed, so it is safe to retire the old ones. Doing this
  // before the attach succeeded would leave the order with no current prelim
  // whenever the upload failed.
  if (progress.supersededCount === undefined) {
    progress.supersededCount = await supersedePriorPrelims(orderId, documentId);
    await saveProgress(jobId, progress);
  }

  // 3 — note. Subject is prepended into Text; AddNotes has no Subject field.
  let note = step(true, 'already added on an earlier attempt');
  if (!progress.noted) {
    // supersededCount is the honest answer to "did we already hold a prelim?" —
    // it counts the active prelims this upload retired. Derived from our own
    // rows a moment ago, not from what the client claimed on submit.
    const noteText = buildPrelimNoteText({
      subject: payload.subject,
      note: payload.note,
      hubHeldPrelim: (progress.supersededCount ?? 0) > 0,
    });
    const noteResult = await addNotes(orderNumber, noteText);
    note = step(
      noteResult.success,
      noteResult.success ? null : (noteResult.error?.message ?? 'AddNotes failed'),
    );
    if (!note.ok) {
      throw new Error(`update-prelim: attached but AddNotes failed: ${note.detail}`);
    }
    progress.noted = true;
    await saveProgress(jobId, progress);
  }

  // 4 — task, last of the SoftPro calls and honoured. Legacy's
  // updateTaskStatus() returned nothing, so a failed task was invisible.
  let task = step(true, 'already opened on an earlier attempt');
  if (!progress.tasked) {
    const taskResult = await addTask(orderNumber, UPDATE_PRELIM_TASK_ID);
    task = step(
      taskResult.success,
      taskResult.success ? null : (taskResult.error?.message ?? 'AddTask failed'),
    );
    if (!task.ok) {
      throw new Error(`update-prelim: attached and noted but AddTask failed: ${task.detail}`);
    }
    progress.tasked = true;
    await saveProgress(jobId, progress);
  }

  // 5 — email. Recipients come from notification_types.internal_cc, editable
  // in Admin → Notifications. Nothing is hard-coded here.
  let email = step(true, 'already sent on an earlier attempt');
  if (!progress.emailed) {
    email = await sendUpdatePrelimEmail({
      orderId,
      orderNumber,
      subject: payload.subject,
      note: payload.note,
      documentId,
      verifyState: progress.verifyState ?? 'accepted',
      requestedBy: payload.requestedBy,
    });
    if (email.ok) {
      progress.emailed = true;
      await saveProgress(jobId, progress);
    }
  }

  return {
    documentId,
    orderNumber,
    attach: step(true, verifyDetail),
    verifyState: progress.verifyState ?? 'accepted',
    note,
    task,
    email,
    supersededCount: progress.supersededCount ?? 0,
  };
}

async function sendUpdatePrelimEmail(input: {
  orderId: number;
  orderNumber: string;
  subject: string;
  note: string;
  documentId: number;
  verifyState: SoftProAttachVerifyState;
  requestedBy: string;
}): Promise<UpdatePrelimStepResult> {
  try {
    const [order] = await db
      .select({ fileNumber: orders.fileNumber })
      .from(orders)
      .where(eq(orders.id, input.orderId))
      .limit(1);

    const fileNumber = order?.fileNumber ?? input.orderNumber;
    const escapedNote = escapeHtml(input.note);
    // Two different sentences on purpose. The recipient should be able to tell,
    // from the email alone, whether we saw the prelim land.
    const filedNote = input.verifyState === 'confirmed'
      ? 'Confirmed: the SoftPro prelim listing returned this document.'
      : `Accepted, unconfirmed (${SOFTPRO_ACCEPTED_NOT_CONFIRMED_COPY}): SoftPro took the write, but the prelim listing did not return the name. The document is very likely on the file — this is not a failure — but we did not see it there.`;

    const result = await dispatchNotification({
      eventType: 'order.prelim.updated',
      orderId: input.orderId,
      data: {
        // Matches the button and modal wording verbatim, so a rep who gets a
        // reply recognises what it is about.
        subject: `Request Updated Prelim — ${fileNumber}: ${input.subject}`.slice(0, 480),
        html: [
          `<p><strong>Request Updated Prelim — ${escapeHtml(fileNumber)}.</strong></p>`,
          `<p>${escapeHtml(input.requestedBy)} sent an updated prelim and is asking production to action it.</p>`,
          `<p><strong>Subject:</strong> ${escapeHtml(input.subject)}</p>`,
          `<p><strong>Note:</strong><br>${escapedNote.replace(/\n/g, '<br>')}</p>`,
          `<p>SoftPro task ${UPDATE_PRELIM_TASK_ID} is open. ${filedNote}</p>`,
          `<p style="color:#6b7280;font-size:12px">Requested by ${escapeHtml(input.requestedBy)} · document #${input.documentId}</p>`,
        ].join(''),
      },
    });

    if (result.sent === 0 && result.failed === 0 && !result.skipped) {
      return step(false, 'no recipients resolved — set internal_cc on order.prelim.updated');
    }
    if (result.skipped) return step(false, 'notification type disabled');
    if (result.failed > 0) return step(false, `${result.failed} recipient(s) failed`);

    return step(true, `${result.sent} recipient(s)`);
  } catch (err) {
    // The prelim is attached and the task is open, so the operator's work is
    // done and visible in SoftPro. A failed email must not undo that.
    return step(false, err instanceof Error ? err.message : 'email dispatch threw');
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}