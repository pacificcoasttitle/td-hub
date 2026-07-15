import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { contacts, documents, orderProperties, orders } from '@/lib/db/schema';
import { downloadFile } from '@/lib/integrations/s3/client';
import { sendEmail, type SendGridAttachment } from '@/lib/integrations/sendgrid/client';
import {
  resolvePrelimRecipients,
  type PrelimCcRecipient,
  type PrelimRecipient,
  type PrelimRecipientResolution,
} from './prelim-recipient-resolution';

const FROM_EMAIL = 'openorders@pct.com';
const PRELIM_CATEGORY = 'prelim';

export interface ReviewedPrelimRecipients {
  to: PrelimRecipient;
  cc: Array<PrelimCcRecipient | (PrelimRecipient & { source?: string })>;
}

export interface PrelimDeliveryResult {
  messageId: string;
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
      <ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>
    </div>`,
  };
}

function buildEmailContent(params: {
  context: OrderEmailContext;
  intendedRecipients: ReviewedPrelimRecipients;
  testMode: boolean;
}): { html: string; text: string; subject: string } {
  const { context, intendedRecipients, testMode } = params;
  const propertyAddress = detailValue(context.propertyAddress);
  const titleOfficer = detailValue(context.titleOfficerName);
  const titleOfficerContact = [
    context.titleOfficerEmail,
    context.titleOfficerPhone,
  ].filter((value): value is string => Boolean(value?.trim())).join(' | ');
  const testBlock = testMode ? buildTestBlock(intendedRecipients) : null;

  const subject = `Preliminary Title Report — ${propertyAddress} — File ${context.fileNumber}`;
  const intro = 'The Preliminary Title Report for the property below is attached.';
  const guidance = 'Please review it carefully. If you have any questions regarding this prelim, contact the title unit — reply to this email or call the number below.';
  const details = [
    ['Property', propertyAddress],
    ['File #', context.fileNumber],
    ['Escrow #', context.fileNumber],
    ['APN', detailValue(context.apn)],
    ['Title Officer', titleOfficerContact ? `${titleOfficer} (${titleOfficerContact})` : titleOfficer],
  ];

  const text = [
    testBlock?.text,
    intro,
    guidance,
    '',
    ...details.map(([label, value]) => `${label}: ${value}`),
  ].filter(Boolean).join('\n');

  const detailRows = details
    .map(([label, value]) => `<tr><th align="left" style="padding:4px 12px 4px 0;">${escapeHtml(label)}</th><td style="padding:4px 0;">${escapeHtml(value)}</td></tr>`)
    .join('');

  const html = `${testBlock?.html ?? ''}
    <p>${escapeHtml(intro)}</p>
    <p>${escapeHtml(guidance)}</p>
    <table role="presentation" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">${detailRows}</table>`;

  return { html, text, subject };
}

async function loadOrderEmailContext(orderId: number): Promise<OrderEmailContext> {
  const [row] = await db
    .select({
      fileNumber: orders.fileNumber,
      propertyAddress: orderProperties.fullAddress,
      fallbackAddress: orderProperties.address,
      city: orderProperties.city,
      state: orderProperties.state,
      zip: orderProperties.zip,
      apn: orderProperties.apn,
      titleOfficerEmail: contacts.email,
      titleOfficerName: contacts.fullName,
      titleOfficerPhone: contacts.phone,
      titleOfficerCell: contacts.cell,
    })
    .from(orders)
    .leftJoin(orderProperties, eq(orderProperties.orderId, orders.id))
    .leftJoin(contacts, eq(orders.titleOfficerId, contacts.id))
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!row) throw new Error(`Order ${orderId} not found`);

  const fallbackAddress = [
    row.fallbackAddress,
    row.city,
    row.state,
    row.zip,
  ].filter((value): value is string => Boolean(value?.trim())).join(', ');

  return {
    fileNumber: row.fileNumber,
    propertyAddress: row.propertyAddress ?? (fallbackAddress || null),
    apn: row.apn,
    titleOfficerEmail: row.titleOfficerEmail,
    titleOfficerName: row.titleOfficerName,
    titleOfficerPhone: row.titleOfficerPhone ?? row.titleOfficerCell,
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
): Promise<PrelimDeliveryResult> {
  const resolvedRecipients = await resolvePrelimRecipients(orderId);
  if (resolvedRecipients.blocked || !resolvedRecipients.to) {
    throw new Error(resolvedRecipients.blockReason ?? 'No valid prelim recipient resolved');
  }

  const [context, prelimAttachment] = await Promise.all([
    loadOrderEmailContext(orderId),
    loadPrelimPdfAttachment(orderId),
  ]);

  const testRecipient = process.env.PRELIM_DELIVERY_TEST_RECIPIENT?.trim();
  const testMode = Boolean(testRecipient);
  const { html, text, subject } = buildEmailContent({
    context,
    intendedRecipients: reviewedRecipients,
    testMode,
  });
  const replyTo = context.titleOfficerEmail?.trim() || FROM_EMAIL;

  const sendResult = await sendEmail({
    to: testRecipient || reviewedRecipients.to.email,
    cc: testRecipient ? [] : reviewedRecipients.cc.map((recipient) => recipient.email),
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

  return {
    messageId: sendResult.data.messageId,
    testMode,
    sentTo: [testRecipient || reviewedRecipients.to.email],
    sentCc: testRecipient ? [] : reviewedRecipients.cc.map((recipient) => recipient.email),
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
  };
}
