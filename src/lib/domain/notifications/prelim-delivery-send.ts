import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { documents } from '@/lib/db/schema';
import { downloadFile } from '@/lib/integrations/s3/client';
import { sendEmail, type SendGridAttachment } from '@/lib/integrations/sendgrid/client';
import { applyVisibility, getOrderReadModel } from '@/lib/domain/orders/read-model';
import {
  BORDER_SOFT,
  ORANGE_TINT,
  PCT_NAVY,
  PCT_ORANGE,
  TEXT_PRIMARY,
  detailsRow,
  emailLayout,
  esc,
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function buildEmailContent(params: {
  context: OrderEmailContext;
  attachment: Pick<PrelimDocumentAttachment, 'sizeBytes'>;
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
  const attachmentLabel = `Preliminary Title Report.pdf · ${formatBytes(attachment.sizeBytes)}`;
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

  const detailRows = details.map(([label, value]) => detailsRow(label, value)).join('');

  const body = `${testBlock?.html ?? ''}
    <p style="margin:0 0 10px;font-size:16px;font-weight:700;color:${PCT_NAVY};">Hello,</p>
    <p style="margin:0 0 18px;font-size:15px;color:${TEXT_PRIMARY};line-height:1.6;">${esc(intro)} <b>${esc(review)}</b></p>
    <div style="display:inline-block;border:1px solid ${BORDER_SOFT};border-radius:999px;padding:9px 14px;margin:0 0 20px;background:#FFFFFF;color:${TEXT_PRIMARY};font-size:13px;font-weight:700;">
      <span style="color:${PCT_ORANGE};font-size:15px;margin-right:8px;">▣</span>${esc(attachmentLabel)}
    </div>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border-radius:10px;margin:0 0 20px;border:1px solid ${BORDER_SOFT};">${detailRows}</table>
    <div style="background:${ORANGE_TINT};border-left:3px solid ${PCT_ORANGE};padding:14px 16px;margin:0 0 4px;">
      <p style="margin:0;font-size:14px;color:${TEXT_PRIMARY};line-height:1.6;"><strong>Questions about this prelim?</strong> Contact the title unit — reply to this email or call the number below.</p>
    </div>`;
  const html = emailLayout('Preliminary Title Report', body);

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
    attachment: { sizeBytes: data.attachmentSizeBytes },
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

  return {
    documentId: prelim.id,
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

export async function sendPrelimDeliveryEmail(
  orderId: number,
  reviewedRecipients: ReviewedPrelimRecipients,
  actor: PrelimDeliveryActor,
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

  const testMode = deliveryMode.mode === 'test';
  const { html, text, subject } = buildEmailContent({
    context,
    attachment: prelimAttachment,
    intendedRecipients: reviewedRecipients,
    testMode,
  });
  const replyTo = context.titleOfficerEmail?.trim() || FROM_EMAIL;

  const sendResult = await sendEmail({
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
