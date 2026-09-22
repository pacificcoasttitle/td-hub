/**
 * Notify rep: tell the rep a report branded to them is ready, PDF attached.
 *
 * ─── A SEND THAT CANNOT WRITE ITS LOG ROW IS NOT SENT ───────────────────────
 *
 * The rule from the handoff, and the reason for the order below. The prelim
 * path had the opposite rule — logging never blocks a send — and recorded one
 * delivery out of 1,083.
 *
 * The handoff phrases it as "the log row is written in the same transaction as
 * the attempt". A database transaction around an email send cannot honour the
 * rule, because the send is not transactional: if the final write fails, the
 * rollback erases the only record of an email that DID go out. So instead:
 *
 *   1. the row is COMMITTED first, as a failure-until-proven-otherwise —
 *      outcome 'failed', detail "the outcome was not recorded";
 *   2. only once it exists is the email sent; if the row cannot be written,
 *      nothing is sent;
 *   3. the row is then updated to what actually happened — 'sent' with
 *      the provider's message id, or 'failed' with the provider's reason,
 *      verbatim.
 *
 * The one residue: a process that dies between 2 and 3 leaves an email sent
 * and a row that says failed-unrecorded. That is the conservative way round —
 * it says "check this" rather than "never sent" — and the only one available.
 *
 * ─── WHAT IS NOT AN ATTEMPT ─────────────────────────────────────────────────
 *
 * A report that is not generated, or whose rep has no email address, is
 * refused before anything is written: there was nobody to send to and nothing
 * to send. Reading the PDF IS part of the attempt — a report whose stored file
 * cannot be read gets a failed row saying so.
 */
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { reportDeliveries } from '@/lib/db/schema';
import { downloadFile } from '@/lib/integrations/s3/client';
import { sendEmail } from '@/lib/integrations/sendgrid/client';
import { getNotifyTarget, type FarmingType } from './stored';
import { notifyHtml, notifySubject, notifyText } from './notify-email';

/** What the row says while the attempt is in flight, and forever if it dies. */
export const OUTCOME_UNRECORDED = 'Attempt started; the outcome was not recorded. Check the email log before notifying again.';

export type NotifyOutcome =
  | { ok: true; deliveryId: number; recipientName: string; recipientEmail: string }
  /** Nothing was attempted; nothing was written. */
  | { ok: false; deliveryId: null; reason: 'not_found' | 'not_generated' | 'no_email'; message: string }
  /** An attempt was made and failed; this row says why. */
  | { ok: false; deliveryId: number; reason: 'pdf_unreadable' | 'provider'; message: string };

export async function notifyRep(input: { type: FarmingType; id: number; sentBy: string }): Promise<NotifyOutcome> {
  const target = await getNotifyTarget(input.type, input.id);
  if (!target) return { ok: false, deliveryId: null, reason: 'not_found', message: 'No such report.' };
  if (target.status !== 'generated' || !target.pdfKey) {
    return { ok: false, deliveryId: null, reason: 'not_generated', message: 'Only a generated report can be sent to its rep.' };
  }
  const email = target.repEmail?.trim();
  if (!email) {
    return {
      ok: false, deliveryId: null, reason: 'no_email',
      message: `${target.repName} has no email address on the report, so there is nowhere to send it.`,
    };
  }

  // 1. The row first. If this throws, nothing has been sent.
  const [row] = await db.insert(reportDeliveries).values({
    reportType: input.type,
    reportId: input.id,
    kind: 'notify_rep',
    recipientName: target.repName,
    recipientEmail: email,
    sentBy: input.sentBy,
    outcome: 'failed',
    outcomeDetail: OUTCOME_UNRECORDED,
    payloadMode: 'attachment',
  }).returning({ id: reportDeliveries.id });
  const deliveryId = row!.id;

  const settle = async (outcome: 'sent' | 'failed', detail: string) => {
    await db.update(reportDeliveries).set({ outcome, outcomeDetail: detail }).where(eq(reportDeliveries.id, deliveryId));
  };

  // The attachment is part of the attempt: a stored file we cannot read is a
  // failure worth a row, not a refusal.
  const pdf = await downloadFile(target.pdfKey);
  if (!pdf.success || !pdf.data) {
    const why = 'The report PDF could not be read from storage, so nothing was emailed.';
    await settle('failed', why);
    return { ok: false, deliveryId, reason: 'pdf_unreadable', message: why };
  }

  // 2. The send — only now that its row exists.
  const content = { type: input.type, repName: target.repName, subject: target.subject, subjectDetail: target.subjectDetail, settings: target.settings };
  const sent = await sendEmail({
    to: email,
    subject: notifySubject(content),
    html: notifyHtml(content),
    text: notifyText(content),
    attachments: [{
      content: Buffer.from(pdf.data).toString('base64'),
      type: 'application/pdf',
      filename: target.filename,
      disposition: 'attachment',
    }],
  });

  // 3. What actually happened, in the provider's words.
  if (!sent.success) {
    const why = sent.error?.message ?? 'The email provider refused the message without a reason.';
    await settle('failed', why);
    return { ok: false, deliveryId, reason: 'provider', message: `The email was not sent: ${why}` };
  }
  // SENT, not delivered: acceptance is all SendGrid's reply proves. A bounce
  // after this point is invisible until the event webhook exists.
  await settle('sent', `Accepted by SendGrid, message ${sent.data?.messageId ?? 'id not returned'}. Delivery not confirmed.`);
  return { ok: true, deliveryId, recipientName: target.repName, recipientEmail: email };
}
