import { db } from '@/lib/db/client';
import {
  orders, orderParties, contacts,
  profiles, documents, titlePointData, vendorApiLogs,
  notificationLogs,
} from '@/lib/db/schema';
import { eq, and, inArray, desc } from 'drizzle-orm';
import { sendEmail, type SendGridAttachment } from '@/lib/integrations/sendgrid/client';
import { downloadFile } from '@/lib/integrations/s3/client';
import { getSetting } from '@/lib/domain/settings/service';
import { applyVisibility, getOrderReadModel } from '@/lib/domain/orders/read-model';
import { formatCounty, formatOrderAddress } from '@/lib/domain/orders/order-format';
import {
  orderConfirmationTemplate,
  type ConfirmationParty,
  type ConfirmationTaxData,
} from './confirmation-template';
import {
  OPEN_ORDERS_CONFIRMATION_CC,
  buildConfirmationRecipients,
} from './confirmation-recipients';
import { parseTaxResultData } from './tax-result-data';
import { EMAIL_STATUS_SENT_NO_CLIENT, hasConfirmationEmailStatus } from './confirmation-send-guard';

export { EMAIL_STATUS_SENT_NO_CLIENT } from './confirmation-send-guard';

const DOC_LABELS: Record<string, string> = {
  legal_vesting: 'Legal and Vesting',
  tax: 'Tax Roll',
  grant_deed: 'Recent Grant Deed',
};

export async function handleOrderConfirmation(
  orderId: number,
  payload: Record<string, unknown> | null,
): Promise<void> {
  const testOverride = typeof payload?.testOverrideTo === 'string' ? payload.testOverrideTo.trim() : '';

  // Double-send guard (email_status) — outbox dedup is the primary; this is the belt.
  if (await hasConfirmationEmailStatus(orderId)) {
    console.error(`[order.confirmation] order ${orderId} already sent (email_status) — skipping`);
    return;
  }

  const model = await getOrderReadModel(orderId);
  if (!model) throw new Error(`Order ${orderId} not found`);
  const order = applyVisibility(model, 'staff');

  // Contact-joined parties for recipient resolution + email party blocks (email-specific).
  const partyRows = await db.select({
    role: orderParties.role,
    externalName: orderParties.externalName,
    externalEmail: orderParties.externalEmail,
    externalPhone: orderParties.externalPhone,
    externalCompany: orderParties.externalCompany,
    cFullName: contacts.fullName,
    cEmail: contacts.email,
    cPhone: contacts.phone,
    cCompany: contacts.companyName,
  }).from(orderParties)
    .leftJoin(contacts, eq(orderParties.contactId, contacts.id))
    .where(eq(orderParties.orderId, orderId));

  const toParty = (role: string): ConfirmationParty | null => {
    const p = partyRows.find((r) => r.role === role);
    if (!p) return null;
    return { name: p.cFullName ?? p.externalName, email: p.cEmail ?? p.externalEmail, phone: p.cPhone ?? p.externalPhone, company: p.cCompany ?? p.externalCompany };
  };

  const createdById = order.assignments.createdBy?.id != null
    ? String(order.assignments.createdBy.id)
    : null;
  const opener = await loadOpener(createdById);
  const recipientEmails = await loadRecipientEmails(orderId, {
    escrowOfficerId: order.escrowOfficerId,
    listingAgentId: order.listingAgentId,
    srEmail: order.assignments.salesRep?.email ?? null,
  }, partyRows);
  const taxData = await loadTaxData(orderId);
  const legalDescription = await loadLegalDescription(orderId, order.property.legalDescription);
  const tpShutOff = (await getSetting('titlepoint_shut_off')) === 'true';

  // Attach whatever LV/tax/grant-deed PDFs exist — never block on missing ones.
  const { attachments, labels: attachedDocLabels } = await buildAttachments(orderId);

  const address = order.property.addressFormatted !== '—'
    ? order.property.addressFormatted
    : (formatOrderAddress({
        address: order.property.line1,
        city: order.property.city,
        state: order.property.state,
        zip: order.property.zip,
      }) || null);
  const addressOrNull = address === '—' ? null : address;
  const countyRaw = order.property.county === '—' ? null : order.property.county;
  const county = formatCounty(countyRaw);
  const salesPrice = order.financials.salesPriceFormatted !== '—'
    ? order.financials.salesPriceFormatted
    : null;
  const loanAmount = order.financials.loanAmountFormatted !== '—'
    ? order.financials.loanAmountFormatted
    : null;

  const titleOfficerAssignment = order.assignments.titleOfficer;
  const titleOfficer = titleOfficerAssignment && (titleOfficerAssignment.name || titleOfficerAssignment.email)
    ? {
        name: titleOfficerAssignment.name,
        email: titleOfficerAssignment.email,
        phone: titleOfficerAssignment.phone ?? null,
        company: null,
      }
    : null;

  const { subject, html } = orderConfirmationTemplate({
    fileNumber: order.fileNumber,
    address: addressOrNull,
    transactionType: order.transactionType,
    productType: order.productType,
    salesPrice,
    loanAmount,
    opener,
    titleOfficer,
    property: {
      address: order.property.line1,
      city: order.property.city,
      zip: order.property.zip,
      county: county === '—' ? null : county,
      apn: order.property.apn,
      legalDescription,
    },
    taxData,
    seller: { primary: order.property.primaryOwner, secondary: order.property.secondaryOwner },
    parties: { buyerAgent: toParty('buyer_agent'), listingAgent: toParty('listing_agent'), lender: toParty('lender'), escrow: toParty('escrow_company') },
    assignments: {
      salesRep: order.assignments.salesRep?.name ?? null,
      titleOfficer: order.assignments.titleOfficer?.name ?? null,
    },
    hasDocuments: attachments.length > 0,
    attachedDocLabels,
    isTitlePointActive: !tpShutOff,
  });

  const fromEmail = process.env.OPEN_ORDERS_FROM_EMAIL ?? process.env.FROM_EMAIL ?? OPEN_ORDERS_CONFIRMATION_CC;
  const { to: dedupedTo, cc: dedupedCc, clientRecipientPresent } = recipientEmails;
  const finalTo = testOverride ? [testOverride] : dedupedTo;
  const finalCc = testOverride ? [] : dedupedCc;
  const missingClient = !testOverride && !clientRecipientPresent;

  // openorders@pct.com is always in TO or CC — empty TO is a programming error, not a silent skip.
  if (finalTo.length === 0) {
    await db.update(orders).set({ emailStatus: 'no_recipients', updatedAt: new Date() }).where(eq(orders.id, orderId));
    try {
      await db.insert(notificationLogs).values({
        eventType: 'order.confirmation',
        orderId,
        channel: 'email',
        recipientEmail: null,
        recipientRole: 'to',
        subject,
        status: 'no_recipients',
        provider: 'sendgrid',
        errorMessage: 'Confirmation had zero TO recipients after resolver (unexpected)',
        sentAt: null,
      });
    } catch { /* logging must never mask the failure */ }
    // Do NOT return quietly — outbox must not mark published/success for a non-send.
    throw new Error(`Order ${orderId} confirmation has no recipients`);
  }

  const result = await sendEmail({
    to: finalTo,
    cc: finalCc.length > 0 ? finalCc : undefined,
    subject, html, from: fromEmail,
    attachments: attachments.length > 0 ? attachments : undefined,
  });

  const status = !result.success
    ? 'failed'
    : missingClient
      ? EMAIL_STATUS_SENT_NO_CLIENT
      : 'sent';
  await db.update(orders).set({ emailStatus: status, updatedAt: new Date() }).where(eq(orders.id, orderId));

  try {
    const allRecipients = [
      ...finalTo.map((e) => ({ email: e, recipientRole: 'to' })),
      ...finalCc.map((e) => ({ email: e, recipientRole: 'cc' })),
    ];
    for (const r of allRecipients) {
      await db.insert(notificationLogs).values({
        eventType: 'order.confirmation',
        orderId,
        channel: 'email',
        recipientEmail: r.email,
        recipientRole: r.recipientRole,
        subject,
        status,
        provider: 'sendgrid',
        providerId: result.data?.messageId ?? null,
        errorMessage: result.error?.message
          ?? (missingClient ? 'Sent without client recipient — openorders CC only guaranteed delivery' : null),
        sentAt: result.success ? new Date() : null,
      });
    }
  } catch { /* notification logging must never break the send flow */ }

  if (!result.success) throw new Error(result.error?.message ?? 'Email send failed');

  // Missing client is loud (email_status + logs + ops) but the email DID send — allow outbox publish.
  if (missingClient) {
    console.error(
      `[order.confirmation] order ${orderId} sent without client recipient; status=${EMAIL_STATUS_SENT_NO_CLIENT}`,
    );
  }
}

async function loadOpener(createdBy: string | null): Promise<ConfirmationParty | null> {
  if (!createdBy) return null;
  const [p] = await db.select({
    name: profiles.displayName, email: profiles.email,
    cPhone: contacts.phone, cCompany: contacts.companyName,
  }).from(profiles)
    .leftJoin(contacts, eq(profiles.contactId, contacts.id))
    .where(eq(profiles.id, createdBy)).limit(1);
  if (!p) return null;
  return { name: p.name, email: p.email, phone: p.cPhone, company: p.cCompany };
}

async function loadRecipientEmails(
  orderId: number,
  row: {
    escrowOfficerId: number | null;
    listingAgentId: number | null;
    srEmail: string | null;
  },
  partyRows: Array<{ role: string; externalEmail: string | null; cEmail: string | null }>,
) {
  const loadContactEmail = async (id: number | null): Promise<string | null> => {
    if (!id) return null;
    const [c] = await db.select({ email: contacts.email }).from(contacts).where(eq(contacts.id, id)).limit(1);
    return c?.email ?? null;
  };

  // Form client email lives on orders.client_contact_id (onBehalfOfContactId at create).
  const [orderClient] = await db
    .select({ clientContactId: orders.clientContactId })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  const [clientEmail, escrowOfficerEmail, listingAgentEmail] = await Promise.all([
    loadContactEmail(orderClient?.clientContactId ?? null),
    loadContactEmail(row.escrowOfficerId),
    loadContactEmail(row.listingAgentId),
  ]);

  const buyerAgent = partyRows.find((r) => r.role === 'buyer_agent');
  const buyerAgentEmail = buyerAgent?.cEmail ?? buyerAgent?.externalEmail ?? null;

  return buildConfirmationRecipients({
    clientEmail,
    escrowOfficerEmail,
    listingAgentEmail,
    buyerAgentEmail,
    salesRepEmail: row.srEmail,
    internalCcEmails: process.env.PCT_INTERNAL_CC_EMAILS ?? null,
  });
}

/**
 * Tax section from captured pre-init / fetchResult payload — independent of tax PDF.
 * Accepts result_ready / completed / failed rows that still carry resultData.
 */
async function loadTaxData(orderId: number): Promise<ConfirmationTaxData | null> {
  const taxRows = await db.select({
    metadata: titlePointData.metadata,
    status: titlePointData.status,
  })
    .from(titlePointData)
    .where(and(
      eq(titlePointData.orderId, orderId),
      eq(titlePointData.searchType, 'tax'),
    ))
    .orderBy(desc(titlePointData.createdAt), desc(titlePointData.id))
    .limit(10);

  for (const taxRow of taxRows) {
    if (taxRow.status === 'superseded') continue;
    const meta = (taxRow.metadata as Record<string, unknown>) ?? {};
    const parsed = parseTaxResultData(meta.resultData);
    if (parsed) return parsed;
  }
  return null;
}

async function loadLegalDescription(orderId: number, fallback: string | null): Promise<string | null> {
  const lvRows = await db.select({
    metadata: titlePointData.metadata,
    status: titlePointData.status,
  })
    .from(titlePointData)
    .where(and(
      eq(titlePointData.orderId, orderId),
      eq(titlePointData.searchType, 'legal_vesting'),
    ))
    .orderBy(desc(titlePointData.createdAt), desc(titlePointData.id))
    .limit(10);

  for (const lvRow of lvRows) {
    if (lvRow.status === 'superseded') continue;
    const meta = (lvRow.metadata as Record<string, unknown>) ?? {};
    const result = (meta.resultData as Record<string, unknown>) ?? {};
    for (const key of ['BriefLegal', 'briefLegal', 'LegalDescription', 'legalDescription']) {
      const value = result[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
  }
  return fallback;
}

async function buildAttachments(
  orderId: number,
): Promise<{ attachments: SendGridAttachment[]; labels: string[] }> {
  const docRows = await db.select({
    storageKey: documents.storageKey,
    filename: documents.filename,
    category: documents.category,
  })
    .from(documents)
    .where(and(
      eq(documents.orderId, orderId),
      inArray(documents.category, ['legal_vesting', 'tax', 'grant_deed']),
      eq(documents.status, 'active'),
    ));

  const attachments: SendGridAttachment[] = [];
  const labels: string[] = [];
  const order = ['legal_vesting', 'tax', 'grant_deed'] as const;

  for (const cat of order) {
    const doc = docRows.find((d) => d.category === cat);
    if (!doc) continue;
    try {
      const result = await downloadFile(doc.storageKey);
      if (result.success && result.data) {
        attachments.push({
          content: result.data.toString('base64'),
          type: 'application/pdf',
          filename: doc.filename,
        });
        labels.push(DOC_LABELS[cat] ?? cat);
      }
    } catch {
      try {
        await db.insert(vendorApiLogs).values({
          vendor: 'sendgrid', operation: 'confirmation_doc_download_failed', orderId,
          requestId: crypto.randomUUID(), startedAt: new Date(), endedAt: new Date(),
          success: false, errorCategory: 'S3_DOWNLOAD',
          requestMeta: { storageKey: doc.storageKey, category: doc.category } as Record<string, unknown>,
        });
      } catch { /* never fail the email send */ }
    }
  }
  return { attachments, labels };
}
