import { and, desc, eq } from 'drizzle-orm';
import { refreshBeforeSend, type PreSendDecision, type PreSendRole } from './pre-send-refresh';
import { db } from '@/lib/db/client';
import {
  adminActivityLogs,
  documentAudit,
  documents,
  orderNotes,
  orderStatusHistory,
  orders,
} from '@/lib/db/schema';
import { downloadFile, getSignedUrl } from '@/lib/integrations/s3/client';
import { addNotes } from '@/lib/integrations/softpro';
import { sendEmail, type SendGridAttachment } from '@/lib/integrations/sendgrid/client';
import { applyVisibility, getOrderReadModel } from '@/lib/domain/orders/read-model';
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
import { dispatchNotification, insertNotificationLog } from './dispatch';
import { isPolicyDeliveryEnabled, POLICY_DELIVERY_ENABLED_SETTING } from './policy-delivery-flag';
import { POLICY_LABELS, type PolicyKind } from './policy-classify';
import {
  policySendLine,
  resolvePolicyRecipients,
  type PolicyParty,
  type PolicyRecipientResolution,
} from './policy-recipients';

export const POLICY_DELIVERY_EVENT = 'policy.delivery';
export const POLICY_UNRESOLVED_EVENT = 'policy.delivery.unresolved';
const FROM_EMAIL = 'openorders@pct.com';
const LINK_EXPIRY_SECONDS = 7 * 24 * 60 * 60;
const SYSTEM_ACTOR = {
  id: 'system:policy_delivery',
  name: 'TD Hub Policy Delivery',
  email: FROM_EMAIL,
};

export interface PolicyEmailInput {
  kind: PolicyKind;
  fileNumber: string;
  propertyAddress: string | null;
  apn: string | null;
  titleOfficerName: string | null;
  filename: string;
  sizeBytes: number;
  downloadUrl: string | null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function buildPolicyDeliveryEmail(input: PolicyEmailInput): { subject: string; html: string; text: string } {
  const label = POLICY_LABELS[input.kind];
  const property = input.propertyAddress?.trim() || 'Not available';
  const subject = `${label} — ${property} — File ${input.fileNumber}`;
  const attachmentLabel = `${input.filename} · ${formatBytes(input.sizeBytes)}`;
  const details = [
    ['Document', label],
    ['Property', property],
    ['File number', input.fileNumber],
    ['APN', input.apn?.trim() || 'Not available'],
    ['Title officer', input.titleOfficerName?.trim() || 'Not available'],
  ];

  const intro = `The ${label.toLowerCase()} for the property below is attached.`;
  const text = [
    'Hello,',
    intro,
    '',
    attachmentLabel,
    '',
    ...details.map(([k, v]) => `${k}: ${v}`),
    '',
    'Questions about this policy? Reply to this email or contact the title unit.',
  ].join('\n');

  const inner = `<span style="color:${PCT_ORANGE};">PDF</span>&nbsp;&nbsp; ${esc(attachmentLabel)}`;
  const pill = input.downloadUrl
    ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 24px;"><tr><td style="background:${ORANGE_TINT};border-radius:10px;"><a href="${esc(input.downloadUrl)}" style="display:block;padding:13px 16px;color:${TEXT_PRIMARY};font-size:13px;font-weight:bold;text-decoration:none;">${inner}</a></td></tr></table>`
    : `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 24px;"><tr><td style="background:${ORANGE_TINT};border-radius:10px;padding:13px 16px;color:${TEXT_PRIMARY};font-size:13px;font-weight:bold;">${inner}</td></tr></table>`;

  const body = `
<p style="margin:0 0 18px;">Hello,</p>
<p style="margin:0 0 22px;">${esc(intro)}</p>
${pill}
${fieldTable(details.map(([labelText, value]) => ({ label: labelText, valueHtml: esc(value) })))}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:24px 0 0;background:${PCT_DEEP};border-radius:12px;"><tr><td style="padding:18px 20px;color:#ffffff;font-size:14px;line-height:1.55;"><strong style="color:${ORANGE_SOFT};">Questions about this policy?</strong><br>Reply to this email or contact the title unit shown above.</td></tr></table>`;

  return {
    subject,
    text,
    html: emailShell({
      title: subject,
      badge: label,
      preheader: `${label} for ${input.fileNumber} is ready.`,
      hero: {
        icon: 'P',
        eyebrow: 'Document delivery',
        headline: `${label} is ready.`,
        subcopy: 'Review the attached policy and contact your title team with questions.',
      },
      tracker: { stage: 3, fileNumber: input.fileNumber, address: input.propertyAddress },
      bodyHtml: body,
    }),
  };
}

export function buildPolicyUnresolvedEmail(input: {
  kind: PolicyKind;
  fileNumber: string;
  propertyAddress: string | null;
  missing: string[];
}): { subject: string; html: string } {
  const label = POLICY_LABELS[input.kind];
  const subject = `Cannot deliver ${label.toLowerCase()} — ${input.fileNumber}`;
  const missing = input.missing.join(', ');
  const body = `
<p style="margin:0 0 18px;"><strong>A ${esc(label.toLowerCase())} is on file and was not sent.</strong></p>
<p style="margin:0 0 22px;">No ${esc(missing)} could be resolved on this order. Until the party wizard exists that will be most owner's policies. Do not guess an address.</p>
${fieldTable([
    { label: 'File number', valueHtml: esc(input.fileNumber) },
    { label: 'Property', valueHtml: esc(input.propertyAddress ?? '—') },
    { label: 'Missing', valueHtml: esc(missing) },
  ])}`;

  return {
    subject,
    html: emailShell({
      title: subject,
      badge: 'Needs attention',
      preheader: `${label} for ${input.fileNumber} has no recipient.`,
      hero: {
        icon: '!',
        eyebrow: 'Policy not delivered',
        headline: 'Recipient could not be resolved.',
        subcopy: 'The document is on file. A person has to name who it goes to.',
      },
      tracker: { stage: 3, fileNumber: input.fileNumber, address: input.propertyAddress },
      bodyHtml: body,
    }),
  };
}

export type PolicyDeliveryOutcome =
  | 'delivered'
  | 'unresolved'
  | 'unclassified'
  | 'disabled'
  | 'failed';

export interface PolicyDeliveryResult {
  outcome: PolicyDeliveryOutcome;
  sent: boolean;
  kind: PolicyKind | null;
  messageId?: string;
  missing?: string[];
  warning?: string;
}

const SENT_FLAG: Record<PolicyKind, 'lenderPolicySent' | 'ownerPolicySent' | 'supplementStatementSent'> = {
  lender_policy: 'lenderPolicySent',
  owner_policy: 'ownerPolicySent',
  supplement: 'supplementStatementSent',
};

export async function deliverPolicyDocument(input: {
  orderId: number;
  documentId: number;
  kind: PolicyKind | null;
}): Promise<PolicyDeliveryResult> {
  if (!(await isPolicyDeliveryEnabled())) {
    try {
      await insertNotificationLog({
        eventType: POLICY_DELIVERY_EVENT,
        orderId: input.orderId,
        channel: 'skip',
        status: 'skipped',
        metadata: { reason: 'policy_delivery_disabled', setting: POLICY_DELIVERY_ENABLED_SETTING, kind: input.kind },
      });
    } catch { /* logging must not block the store-and-wait path */ }
    return { outcome: 'disabled', sent: false, kind: input.kind };
  }

  const model = await getOrderReadModel(input.orderId);
  if (!model) return { outcome: 'failed', sent: false, kind: input.kind };

  const order = applyVisibility(model, 'staff');
  const propertyAddress = order.property.addressFormatted !== '—'
    ? order.property.addressFormatted
    : null;

  if (!input.kind) {
    const { subject, html } = buildPolicyUnresolvedEmail({
      kind: 'owner_policy',
      fileNumber: order.fileNumber,
      propertyAddress,
      missing: ['classified type'],
    });
    await dispatchNotification({
      eventType: POLICY_UNRESOLVED_EVENT,
      orderId: input.orderId,
      data: { subject, html, reason: 'unclassified' },
    });
    return { outcome: 'unclassified', sent: false, kind: null, missing: ['classified type'] };
  }

  const resolved = await resolvePolicyRecipients(input.orderId, input.kind);
  if (!resolved.ok) {
    return failClosed(input.orderId, order.fileNumber, propertyAddress, resolved);
  }

  const resolvedLine = policySendLine(resolved);
  if (!resolvedLine) {
    return failClosed(input.orderId, order.fileNumber, propertyAddress, resolved);
  }

  // PRE-SEND REFRESH — the same rule as the prelim (pre-send-refresh.ts): send to
  // SoftPro's recipient when it differs, record and alert; if SoftPro holds none
  // for a recipient this policy needs, fail closed rather than use ours.
  const refreshed = await refreshPolicyLine(input.orderId, order.fileNumber, input.kind, resolvedLine, order.orderType);
  if (!refreshed.ok) {
    return failClosed(input.orderId, order.fileNumber, propertyAddress, {
      ...resolved,
      ok: false,
      missing: refreshed.missing,
    });
  }
  const line = refreshed.line;

  const attachment = await loadPolicyAttachment(input.documentId);
  const { subject, html, text } = buildPolicyDeliveryEmail({
    kind: input.kind,
    fileNumber: order.fileNumber,
    propertyAddress,
    apn: order.property.apn,
    titleOfficerName: order.assignments.titleOfficer?.name ?? null,
    filename: attachment.filename,
    sizeBytes: attachment.sizeBytes,
    downloadUrl: attachment.downloadUrl,
  });

  const sendResult = await sendEmail({
    orderId: input.orderId,
    to: line.to.email,
    cc: line.cc.map((p) => p.email),
    from: FROM_EMAIL,
    subject,
    html,
    text,
    attachments: [attachment.attachment],
  });

  if (!sendResult.success || !sendResult.data) {
    return { outcome: 'failed', sent: false, kind: input.kind };
  }

  await logRecipients(input.orderId, input.kind, subject, [line.to, ...line.cc], sendResult.data.messageId);
  const warning = await writePolicyDeliveryProofs({
    orderId: input.orderId,
    fileNumber: order.fileNumber,
    documentId: input.documentId,
    kind: input.kind,
    sendgridMessageId: sendResult.data.messageId,
    to: line.to,
    cc: line.cc,
  });

  await db.update(orders).set({
    [SENT_FLAG[input.kind]]: true,
    updatedAt: new Date(),
  }).where(eq(orders.id, input.orderId));

  return {
    outcome: 'delivered',
    sent: true,
    kind: input.kind,
    messageId: sendResult.data.messageId,
    warning,
  };
}

async function failClosed(
  orderId: number,
  fileNumber: string,
  propertyAddress: string | null,
  resolved: PolicyRecipientResolution,
): Promise<PolicyDeliveryResult> {
  const { subject, html } = buildPolicyUnresolvedEmail({
    kind: resolved.kind,
    fileNumber,
    propertyAddress,
    missing: resolved.missing,
  });
  await dispatchNotification({
    eventType: POLICY_UNRESOLVED_EVENT,
    orderId,
    data: { subject, html, reason: 'unresolved', missing: resolved.missing, kind: resolved.kind },
  });
  return {
    outcome: 'unresolved',
    sent: false,
    kind: resolved.kind,
    missing: resolved.missing,
  };
}

async function logRecipients(
  orderId: number,
  kind: PolicyKind,
  subject: string,
  parties: PolicyParty[],
  messageId: string,
): Promise<void> {
  for (const [i, party] of parties.entries()) {
    try {
      await insertNotificationLog({
        eventType: POLICY_DELIVERY_EVENT,
        orderId,
        channel: 'email',
        recipientEmail: party.email,
        recipientName: party.name,
        recipientRole: party.role,
        subject,
        templateUsed: POLICY_DELIVERY_EVENT,
        status: 'sent',
        provider: 'sendgrid',
        providerId: messageId,
        metadata: { kind, kind_index: i },
        sentAt: new Date(),
      });
    } catch { /* logging must not block the send */ }
  }
}

async function loadPolicyAttachment(documentId: number): Promise<{
  filename: string;
  sizeBytes: number;
  downloadUrl: string | null;
  attachment: SendGridAttachment;
}> {
  const [doc] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.status, 'active')))
    .orderBy(desc(documents.createdAt))
    .limit(1);
  if (!doc) throw new Error(`Policy document ${documentId} not found`);

  const file = await downloadFile(doc.storageKey);
  if (!file.success || !file.data) {
    throw new Error(file.error?.message ?? 'Failed to download policy PDF');
  }
  const signed = await getSignedUrl(doc.storageKey, LINK_EXPIRY_SECONDS);
  const downloadUrl = signed.success ? signed.data ?? null : null;

  return {
    filename: doc.originalFilename ?? doc.filename,
    sizeBytes: doc.sizeBytes ?? file.data.length,
    downloadUrl,
    attachment: {
      content: file.data.toString('base64'),
      filename: doc.originalFilename ?? doc.filename,
      type: doc.contentType ?? 'application/pdf',
      disposition: 'attachment',
    },
  };
}

async function writePolicyDeliveryProofs(input: {
  orderId: number;
  fileNumber: string;
  documentId: number;
  kind: PolicyKind;
  sendgridMessageId: string;
  to: PolicyParty;
  cc: PolicyParty[];
}): Promise<string | undefined> {
  const deliveredAt = new Date();
  const softproNoteId = `policy-delivery-${input.fileNumber}-${deliveredAt.getTime()}`;
  const recipients = [
    { ...input.to, kind: 'to' },
    ...input.cc.map((c) => ({ ...c, kind: 'cc' })),
  ];
  const noteText = `${POLICY_LABELS[input.kind]} delivered via TD Hub. Sent to: ${input.to.email}; CC: ${input.cc.map((c) => c.email).join(', ') || 'none'}.`;

  let softproSynced = false;
  try {
    const result = await addNotes(input.fileNumber, noteText, softproNoteId);
    const item = Array.isArray(result.data) ? result.data[0] as { Status?: number; Message?: string } : null;
    softproSynced = item?.Status === 200 && (item.Message ?? '').toLowerCase().includes('successfully');
  } catch { /* note is best-effort; the send already happened */ }

  const meta = {
    delivered_at: deliveredAt.toISOString(),
    recipients,
    sendgrid_message_id: input.sendgridMessageId,
    softpro_note_id: softproNoteId,
    document_id: input.documentId,
    kind: input.kind,
  } as Record<string, unknown>;

  const failed: string[] = [];
  async function write(name: string, fn: () => Promise<unknown>) {
    try { await fn(); } catch { failed.push(name); }
  }

  await write('admin_activity_logs', () => db.insert(adminActivityLogs).values({
    userId: SYSTEM_ACTOR.id,
    action: 'policy_delivered',
    entityType: 'order',
    entityId: String(input.orderId),
    meta,
    createdAt: deliveredAt,
  }));
  await write('order_notes', () => db.insert(orderNotes).values({
    orderId: input.orderId,
    subject: `${POLICY_LABELS[input.kind]} delivered`,
    body: noteText,
    authorName: SYSTEM_ACTOR.name,
    authorId: null,
    isInternal: true,
    softproNoteId,
    isSyncedToSoftpro: softproSynced,
    syncedAt: deliveredAt,
    createdAt: deliveredAt,
  }));
  await write('order_status_history', () => db.insert(orderStatusHistory).values({
    orderId: input.orderId,
    status: `${POLICY_LABELS[input.kind]} delivered`,
    source: 'system',
    notes: noteText,
    changedAt: deliveredAt,
  }));
  await write('document_audit', () => db.insert(documentAudit).values({
    documentId: input.documentId,
    action: 'delivered',
    byUserId: SYSTEM_ACTOR.id,
    meta,
    performedAt: deliveredAt,
  }));

  return failed.length ? `writeback missed: ${failed.join(', ')}` : undefined;
}

export function policyDeliverySampleTemplate(): { subject: string; html: string; text: string } {
  return buildPolicyDeliveryEmail({
    kind: 'lender_policy',
    fileNumber: '20018881-OCT',
    propertyAddress: '123 Main St, Los Angeles, CA',
    apn: '1234-567-890',
    titleOfficerName: 'Dana Reyes',
    filename: 'Lender Policy.pdf',
    sizeBytes: 240_000,
    downloadUrl: 'https://example.com/sample-policy.pdf',
  });
}

const PRE_SEND_ROLE: Record<string, PreSendRole> = {
  escrow_officer: 'escrow',
  escrow_company: 'escrow',
  lender: 'lender',
  buyer: 'owner',
  borrower: 'owner',
};

export async function refreshPolicyLine(
  orderId: number,
  fileNumber: string,
  kind: PolicyKind,
  line: { to: PolicyParty; cc: PolicyParty[] },
  orderType?: string | null,
): Promise<{ ok: true; line: { to: PolicyParty; cc: PolicyParty[] } } | { ok: false; missing: string[] }> {
  const parties = [line.to, ...line.cc];
  const decisions = await refreshBeforeSend({
    orderId,
    fileNumber,
    sendKind: kind,
    orderType,
    candidates: parties.map((p) => ({ role: PRE_SEND_ROLE[p.role] ?? 'escrow', email: p.email, name: p.name })),
  });

  const missing = decisions.filter((d) => d.status === 'softpro_has_none').map((d) => d.role);
  if (missing.length > 0) return { ok: false, missing };

  const apply = (p: PolicyParty, d: PreSendDecision | undefined): PolicyParty =>
    d?.status === 'differs' ? { ...p, email: d.email, name: d.name ?? p.name } : p;
  const to = apply(line.to, decisions[0]);
  const cc = line.cc.map((p, i) => apply(p, decisions[i + 1])).filter((p) => p.email !== to.email);
  return { ok: true, line: { to, cc } };
}
