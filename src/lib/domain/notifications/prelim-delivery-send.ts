import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { documents } from '@/lib/db/schema';
import { downloadFile, getSignedUrl } from '@/lib/integrations/s3/client';
import { sendEmail, type SendGridAttachment } from '@/lib/integrations/sendgrid/client';
import { applyVisibility, getOrderReadModel } from '@/lib/domain/orders/read-model';
import { extractPdfText } from '@/lib/tessa/pdf-extract';
import {
  identifyDocument,
  describeDocumentType,
  type DocumentIdentity,
} from '@/lib/domain/documents/document-identity';
import {
  ORANGE_SOFT,
  ORANGE_TINT,
  PCT_DEEP,
  PCT_ORANGE,
  TEXT_PRIMARY,
  emailShell,
  esc,
  fieldTable,
} from './email-layout';
import {
  resolvePrelimRecipients,
  type PrelimCcRecipient,
  type PrelimRecipient,
  type PrelimRecipientResolution,
} from './prelim-recipient-resolution';
import {
  getPrelimDeliveryMode,
  PRELIM_DELIVERY_NOT_ARMED,
  type PrelimDeliveryMode,
} from './prelim-delivery-mode';
import { writePrelimDeliveryProofs, type PrelimDeliveryWritebackResult } from './prelim-delivery-writeback';

const FROM_EMAIL = 'openorders@pct.com';
const PRELIM_CATEGORY = 'prelim';

export interface ReviewedPrelimRecipients {
  to: PrelimRecipient;
  cc: Array<PrelimCcRecipient | (PrelimRecipient & { source?: string })>;
}

export interface PrelimDeliveryActor {
  id: string;
  name: string;
  email?: string | null;
}

export interface PrelimDeliveryResult {
  messageId: string;
  deliveryMode: PrelimDeliveryMode;
  testMode: boolean;
  sentTo: string[];
  sentCc: string[];
  intendedRecipients: ReviewedPrelimRecipients;
  resolvedRecipients: PrelimRecipientResolution;
  from: string;
  replyTo: string;
  subject: string;
  attachment: {
    documentId: number;
    filename: string;
    contentType: string;
    sizeBytes: number;
  };
  writeback: PrelimDeliveryWritebackResult | null;
  warning?: string;
}

export interface PrelimDeliverySampleData {
  fileNumber: string;
  propertyAddress: string | null;
  apn: string | null;
  titleOfficerName: string | null;
  titleOfficerEmail: string | null;
  titleOfficerPhone: string | null;
  attachmentSizeBytes: number;
  /** Real document filename; the sample sender has no document row. */
  attachmentFilename?: string;
  /** Placeholder stand-in for the presigned URL; the sample sender has no S3 object. */
  attachmentUrl?: string | null;
}

interface OrderEmailContext {
  fileNumber: string;
  propertyAddress: string | null;
  apn: string | null;
  titleOfficerName: string | null;
  titleOfficerEmail: string | null;
  titleOfficerPhone: string | null;
}

interface PrelimDocumentAttachment {
  documentId: number;
  filename: string;
  contentType: string;
  sizeBytes: number;
  /**
   * Presigned S3 URL for the attachment pill.
   *
   * Recipients are EXTERNAL — escrow officers with no TD Hub login — so the
   * authenticated download route would 401 them. Null when presigning fails;
   * the pill then renders unlinked rather than pointing at a broken URL. The
   * PDF is attached either way, so this degrades softly.
   */
  downloadUrl: string | null;
  /** What the document IS — see document-identity.ts. */
  identity: DocumentIdentity;
  attachment: SendGridAttachment;
}

function detailValue(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed || 'Not available';
}

function recipientLine(label: string, recipient: PrelimRecipient): string {
  const name = recipient.name ? `${recipient.name} ` : '';
  return `${label}: ${name}<${recipient.email}> (${recipient.role})`;
}

function ccRecipientLine(recipient: ReviewedPrelimRecipients['cc'][number]): string {
  const source = recipient.source ? ` via ${recipient.source}` : '';
  const name = recipient.name ? `${recipient.name} ` : '';
  return `CC: ${name}<${recipient.email}> (${recipient.role}${source})`;
}

function buildTestBlock(intendedRecipients: ReviewedPrelimRecipients): { text: string; html: string } {
  const lines = [
    recipientLine('TO', intendedRecipients.to),
    ...intendedRecipients.cc.map(ccRecipientLine),
  ];

  return {
    text: `TEST — would have gone to:\n${lines.join('\n')}`,
    html: `<div style="border:2px solid #b45309;background:#fffbeb;padding:12px;margin:0 0 16px;">
      <strong>TEST — would have gone to:</strong>
      <ul>${lines.map((line) => `<li>${esc(line)}</li>`).join('')}</ul>
    </div>`,
  };
}

/** S3 SigV4 caps presigned URLs at 7 days. */
const PRELIM_LINK_EXPIRY_SECONDS = 7 * 24 * 60 * 60;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function buildEmailContent(params: {
  context: OrderEmailContext;
  attachment: Pick<PrelimDocumentAttachment, 'sizeBytes' | 'downloadUrl' | 'filename'>;
  intendedRecipients: ReviewedPrelimRecipients;
  testMode: boolean;
}): { html: string; text: string; subject: string } {
  const { attachment, context, intendedRecipients, testMode } = params;
  const propertyAddress = detailValue(context.propertyAddress);
  const titleOfficer = detailValue(context.titleOfficerName);
  const titleOfficerContact = [
    titleOfficer,
    context.titleOfficerEmail?.trim(),
    context.titleOfficerPhone?.trim(),
  ].filter((value): value is string => Boolean(value)).join(' · ');
  const testBlock = testMode ? buildTestBlock(intendedRecipients) : null;

  const subject = `Preliminary Title Report — ${propertyAddress} — File ${context.fileNumber}`;
  const intro = 'The Preliminary Title Report for the property below is attached.';
  const review = 'Please review it carefully.';
  const guidance = 'Questions about this prelim? Contact the title unit — reply to this email or call the number below.';
  // The REAL document filename, not a hardcoded label. The Aug 11 wrong-document
  // delivery was invisible precisely because this said "Preliminary Title
  // Report.pdf" while the attachment was named dnu_140209.pdf — the two never
  // had to agree. Now a mismatch is visible to sender and recipient.
  const attachmentLabel = `${attachment.filename} · ${formatBytes(attachment.sizeBytes)}`;
  const details = [
    ['Property', propertyAddress],
    ['File number', context.fileNumber],
    ['Escrow number', context.fileNumber],
    ['APN', detailValue(context.apn)],
    ['Title officer', titleOfficerContact],
  ];

  const text = [
    testBlock?.text,
    'Hello,',
    intro,
    review,
    '',
    attachmentLabel,
    '',
    ...details.map(([label, value]) => `${label}: ${value}`),
    '',
    guidance,
  ].filter(Boolean).join('\n');

  const attachmentInner = `<span style="color:${PCT_ORANGE};">PDF</span>&nbsp;&nbsp; ${esc(attachmentLabel)}`;
  const attachmentPill = attachment.downloadUrl
    ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 24px;"><tr><td style="background:${ORANGE_TINT};border-radius:10px;"><a href="${esc(attachment.downloadUrl)}" style="display:block;padding:13px 16px;color:${TEXT_PRIMARY};font-size:13px;font-weight:bold;text-decoration:none;">${attachmentInner}</a></td></tr></table>`
    : `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 24px;"><tr><td style="background:${ORANGE_TINT};border-radius:10px;padding:13px 16px;color:${TEXT_PRIMARY};font-size:13px;font-weight:bold;">${attachmentInner}</td></tr></table>`;

  const body = `${testBlock?.html ?? ''}
<p style="margin:0 0 18px;">Hello,</p>
<p style="margin:0 0 22px;">${esc(intro)} <strong style="color:${TEXT_PRIMARY};">${esc(review)}</strong></p>
${attachmentPill}
${fieldTable(details.map(([label, value]) => ({ label, valueHtml: esc(value) })))}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:24px 0 0;background:${PCT_DEEP};border-radius:12px;"><tr><td style="padding:18px 20px;color:#ffffff;font-size:14px;line-height:1.55;"><strong style="color:${ORANGE_SOFT};">Questions about the prelim?</strong><br>Reply to this email or contact the title unit shown above.</td></tr></table>`;

  const html = emailShell({
    title: subject,
    badge: 'Preliminary report',
    preheader: 'Review the report and contact your title team with questions.',
    hero: {
      icon: 'P',
      eyebrow: 'Document delivery',
      headline: 'Your preliminary report is ready.',
      subcopy: 'Review the report and contact your title team with questions.',
    },
    tracker: { stage: 2, fileNumber: context.fileNumber, address: context.propertyAddress },
    bodyHtml: body,
  });

  return { html, text, subject };
}

export function prelimDeliverySampleTemplate(data: PrelimDeliverySampleData): { subject: string; html: string; text: string } {
  return buildEmailContent({
    context: {
      fileNumber: data.fileNumber,
      propertyAddress: data.propertyAddress,
      apn: data.apn,
      titleOfficerName: data.titleOfficerName,
      titleOfficerEmail: data.titleOfficerEmail,
      titleOfficerPhone: data.titleOfficerPhone,
    },
    attachment: {
      filename: data.attachmentFilename ?? 'Preliminary Title Report.pdf',
      sizeBytes: data.attachmentSizeBytes,
      downloadUrl: data.attachmentUrl ?? 'https://example.com/sample-prelim.pdf',
    },
    intendedRecipients: {
      to: { email: 'escrow.officer@example.com', name: 'Escrow Officer', role: 'escrow_officer' },
      cc: [
        { email: 'title.unit@example.com', name: 'Title Unit', role: 'title_rep', source: 'title_officer' },
        { email: 'assistant@example.com', name: 'Escrow Assistant', role: 'Assistant', source: 'officer_cc_defaults' },
      ],
    },
    testMode: false,
  });
}

async function loadOrderEmailContext(orderId: number): Promise<OrderEmailContext> {
  const model = await getOrderReadModel(orderId);
  if (!model) throw new Error(`Order ${orderId} not found`);
  const order = applyVisibility(model, 'staff');

  const propertyAddress = order.property.addressFormatted !== '—'
    ? order.property.addressFormatted
    : null;

  return {
    fileNumber: order.fileNumber,
    propertyAddress,
    apn: order.property.apn,
    titleOfficerEmail: order.assignments.titleOfficer?.email ?? null,
    titleOfficerName: order.assignments.titleOfficer?.name ?? null,
    titleOfficerPhone: order.assignments.titleOfficer?.phone ?? null,
  };
}

async function loadPrelimPdfAttachment(orderId: number): Promise<PrelimDocumentAttachment> {
  const prelims = await db
    .select({
      id: documents.id,
      filename: documents.filename,
      contentType: documents.contentType,
      storageKey: documents.storageKey,
      sizeBytes: documents.sizeBytes,
      createdAt: documents.createdAt,
    })
    .from(documents)
    .where(and(
      eq(documents.orderId, orderId),
      eq(documents.category, PRELIM_CATEGORY),
      eq(documents.status, 'active'),
    ))
    .orderBy(desc(documents.createdAt), desc(documents.id));

  const prelim = prelims.find((doc) => {
    const contentType = doc.contentType?.toLowerCase() ?? '';
    return contentType.includes('pdf') || doc.filename.toLowerCase().endsWith('.pdf');
  });

  if (!prelim) {
    throw new Error('No active prelim PDF document exists for this order');
  }

  const download = await downloadFile(prelim.storageKey);
  if (!download.success || !download.data) {
    throw new Error(download.error?.message ?? 'Failed to download prelim PDF');
  }

  // Look at what the document actually IS before it can be auto-delivered.
  // The buffer is already in hand here, so this costs no extra download.
  //
  // This used to be a marker COUNT — three of seven title-paperwork phrases
  // and the document passed. Every document in an escrow file has that
  // vocabulary, so on 2026-08-11 and 2026-08-12 two internal Order Summaries
  // went to outside escrow companies as preliminary title reports. It now asks
  // what the document is, and refuses when the answer is anything else.
  let identity: DocumentIdentity;
  try {
    identity = identifyDocument(await extractPdfText(download.data));
  } catch {
    // A PDF we cannot read is a document we cannot identify. That is a refusal,
    // not a pass — the whole point is that not knowing is a safe answer.
    identity = {
      type: 'unidentified',
      matchedOn: '',
      reason: 'no_extractable_text',
      candidates: [],
      textChars: 0,
    };
  }

  // 7 days is the SigV4 maximum. A link that outlives the recipient's attention
  // span is the point; if it does expire, the attached PDF still works, which is
  // why a presign failure below is not fatal.
  const signed = await getSignedUrl(prelim.storageKey, PRELIM_LINK_EXPIRY_SECONDS);
  if (!signed.success || !signed.data) {
    console.warn('[prelim-delivery] presign failed — sending an unlinked pill', {
      documentId: prelim.id,
      message: signed.error?.message,
    });
  }

  return {
    documentId: prelim.id,
    downloadUrl: signed.success ? (signed.data ?? null) : null,
    identity,
    filename: prelim.filename,
    contentType: prelim.contentType ?? 'application/pdf',
    sizeBytes: download.data.length,
    attachment: {
      content: download.data.toString('base64'),
      type: prelim.contentType ?? 'application/pdf',
      filename: prelim.filename,
      disposition: 'attachment',
    },
  };
}

/**
 * Thrown when an AUTO delivery is refused because the document does not read as
 * a preliminary report. Auto-delivery maps this to a manual-review outcome; it
 * is deliberately distinct from a send failure, because the send never happened
 * and retrying would not help.
 */
export class PrelimContentCheckFailedError extends Error {
  constructor(
    readonly reason: string,
    readonly filename: string,
    readonly matched: string[],
  ) {
    super(`Prelim content check failed (${reason}) for ${filename}`);
    this.name = 'PrelimContentCheckFailedError';
  }
}

export interface SendPrelimDeliveryOptions {
  /**
   * Require the document to read as a prelim before sending.
   *
   * TRUE for automatic delivery — nobody looked at the file. FALSE (default)
   * for a manual send, where a human chose the document and may legitimately be
   * sending something the marker rules do not recognise.
   */
  requirePrelimContent?: boolean;
}

export async function sendPrelimDeliveryEmail(
  orderId: number,
  reviewedRecipients: ReviewedPrelimRecipients,
  actor: PrelimDeliveryActor,
  options: SendPrelimDeliveryOptions = {},
): Promise<PrelimDeliveryResult> {
  const resolvedRecipients = await resolvePrelimRecipients(orderId);
  if (resolvedRecipients.blocked || !resolvedRecipients.to) {
    throw new Error(resolvedRecipients.blockReason ?? 'No valid prelim recipient resolved');
  }

  const deliveryMode = getPrelimDeliveryMode();
  if (!deliveryMode.armed) {
    throw new Error(PRELIM_DELIVERY_NOT_ARMED);
  }

  const [context, prelimAttachment] = await Promise.all([
    loadOrderEmailContext(orderId),
    loadPrelimPdfAttachment(orderId),
  ]);

  // The gate. Refuse BEFORE building or sending anything, so a wrong document
  // cannot leave the building on the automatic path.
  // POSITIVE IDENTIFICATION, NOT ABSENCE OF SUSPICION. The document must read
  // as a preliminary title report; anything else — a policy, an order summary,
  // a scan we cannot extract — is refused and routed to a human.
  if (options.requirePrelimContent
      && prelimAttachment.identity.type !== 'clta_preliminary_report') {
    console.warn('[prelim-delivery] refused: document does not read as a prelim', {
      orderId,
      documentId: prelimAttachment.documentId,
      filename: prelimAttachment.filename,
      identifiedAs: prelimAttachment.identity.type,
      reason: prelimAttachment.identity.reason ?? 'wrong_document_type',
      matchedOn: prelimAttachment.identity.matchedOn,
      candidates: prelimAttachment.identity.candidates,
      textChars: prelimAttachment.identity.textChars,
    });
    throw new PrelimContentCheckFailedError(
      `document is ${describeDocumentType(prelimAttachment.identity.type)}`
      + (prelimAttachment.identity.reason ? ` (${prelimAttachment.identity.reason})` : ''),
      prelimAttachment.filename,
      prelimAttachment.identity.candidates,
    );
  }

  const testMode = deliveryMode.mode === 'test';
  const { html, text, subject } = buildEmailContent({
    context,
    attachment: prelimAttachment,
    intendedRecipients: reviewedRecipients,
    testMode,
  });
  const replyTo = context.titleOfficerEmail?.trim() || FROM_EMAIL;

  const sendResult = await sendEmail({
    // The order, so the delivery log is searchable by file number. Every prelim
    // send before 2026-09-10 landed with order_id NULL and an unparseable
    // subject, which is why "did the client get their prelim?" had no answer.
    orderId,
    fileNumber: context.fileNumber,
    to: testMode ? deliveryMode.testRecipient : reviewedRecipients.to.email,
    cc: testMode ? [] : reviewedRecipients.cc.map((recipient) => recipient.email),
    from: FROM_EMAIL,
    replyTo,
    subject,
    html,
    text,
    attachments: [prelimAttachment.attachment],
  });

  if (!sendResult.success || !sendResult.data) {
    throw new Error(sendResult.error?.message ?? 'SendGrid prelim delivery failed');
  }

  let writeback: PrelimDeliveryWritebackResult | null = null;
  let warning: string | undefined;
  try {
    writeback = await writePrelimDeliveryProofs({
      orderId,
      fileNumber: context.fileNumber,
      documentId: prelimAttachment.documentId,
      sendgridMessageId: sendResult.data.messageId,
      recipients: reviewedRecipients,
      actor,
      deliveryMode,
    });
    warning = writeback.warning;
  } catch (err) {
    warning = err instanceof Error ? err.message : 'Prelim delivery writeback failed';
  }

  return {
    messageId: sendResult.data.messageId,
    deliveryMode,
    testMode,
    sentTo: [testMode ? deliveryMode.testRecipient : reviewedRecipients.to.email],
    sentCc: testMode ? [] : reviewedRecipients.cc.map((recipient) => recipient.email),
    intendedRecipients: reviewedRecipients,
    resolvedRecipients,
    from: FROM_EMAIL,
    replyTo,
    subject,
    attachment: {
      documentId: prelimAttachment.documentId,
      filename: prelimAttachment.filename,
      contentType: prelimAttachment.contentType,
      sizeBytes: prelimAttachment.sizeBytes,
    },
    writeback,
    warning,
  };
}
