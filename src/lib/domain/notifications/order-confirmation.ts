import { db } from '@/lib/db/client';
import {
  orders, orderParties, contacts, companies,
  documents, titlePointData, vendorApiLogs,
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
import { deliverableEmailsForSend } from './deliverable-emails';
import { parseTaxResultData } from './tax-result-data';
import { EMAIL_STATUS_SENT_NO_CLIENT, hasConfirmationEmailStatus } from './confirmation-send-guard';
import { isBuyerAgentRecipientEnabled } from './buyer-agent-recipient-gate';

export { EMAIL_STATUS_SENT_NO_CLIENT } from './confirmation-send-guard';

import {
  CONFIRMATION_DOC_LABELS,
  CONFIRMATION_DOC_TYPES,
  hasOutstandingDocuments,
} from './confirmation-documents';

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

  const { client: opener, loanNumber, escrowNumber } = await loadClientAndOrderNumbers(orderId);
  const recipientEmails = await loadRecipientEmails(orderId, {
    escrowOfficerId: order.escrowOfficerId,
    listingAgentId: order.listingAgentId,
    srEmail: order.assignments.salesRep?.email ?? null,
  }, partyRows);
  const taxData = await loadTaxData(orderId);
  const legalDescription = await loadLegalDescription(orderId, order.property.legalDescription);
  const tpShutOff = (await getSetting('titlepoint_shut_off')) === 'true';

  // Attach whatever LV/tax/grant-deed PDFs exist — never block on missing ones.
  const {
    attachments,
    labels: attachedDocLabels,
    outstanding,
    record: attachmentRecord,
  } = await buildAttachments(orderId);

  /*
    WHO THE CONFIRMATION WENT TO, recorded alongside WHAT IT CARRIED.

    The outstanding-documents alert has to tell a person which customer is
    still owed documents. Deriving that later from the order would answer "who
    is the client now", which is not the same question — parties get corrected
    after a send. This records who was actually written to, at the time.

    `opener` is the client contact resolved for the TO line; when the order has
    no client contact it is null, `clientRecipientPresent` is false, and the
    alert says so rather than inventing a recipient.
  */
  const sendRecord = {
    ...attachmentRecord,
    clientName: opener?.name ?? null,
    clientEmail: opener?.email ?? null,
  };

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
    openedAt: order.dates.openedAtIso,
    address: addressOrNull,
    transactionType: order.transactionType,
    productType: order.productType,
    salesPrice,
    loanAmount,
    loanNumber,
    escrowNumber,
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
    hasOutstandingDocuments: outstanding,
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
        metadata: sendRecord,
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

  /*
    RECORD WHAT THE MESSAGE CARRIED.

    961 confirmations were sent before this line existed and not one of them
    recorded its attachments, so the only way to ask "did this email have the
    grant deed" was to compare the document's created_at against sent_at and
    infer. That answers "the row did not exist yet" and cannot answer "the row
    existed and did not attach" — which is exactly what an S3 download failure
    looks like, and it is silent.

    Stored per recipient row rather than once per send. The rows are already
    per recipient, and a metadata column that is populated on some rows of a
    send and null on others is worse to query than one that is always there.
  */
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
        metadata: sendRecord,
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

/**
 * The order-summary block on the confirmation describes the CLIENT the order was
 * opened for. Company, Address, City and ZIP sit under it, and those only make
 * sense as the client's — "Atlas Escrow, 3731 Wilshire Boulevard", not a PCT
 * desk.
 *
 * It used to read the staff profile that clicked the button, joined to contacts
 * through profiles.contact_id. Most staff profiles carry no contact row, so the
 * join produced nulls and five rows rendered as em dashes while the client's
 * real details sat on orders.client_contact_id — the same row the SoftPro
 * payload built ClientLookupCode and CompanyLookupCode from.
 *
 * Company resolves through companies.lookup_code the way the payload does: a
 * client contact frequently has company_name NULL and carries only flookup_code.
 *
 * Loan and escrow number come from the same row because they live on orders and
 * are read nowhere else — the template declared both fields and was never
 * passed either.
 */
async function loadClientAndOrderNumbers(orderId: number): Promise<{
  client: ConfirmationParty | null;
  loanNumber: string | null;
  escrowNumber: string | null;
}> {
  const [row] = await db.select({
    loanNumber: orders.loanNumber,
    escrowNumber: orders.escrowNumber,
    contactId: contacts.id,
    fullName: contacts.fullName,
    firstName: contacts.firstName,
    lastName: contacts.lastName,
    email: contacts.email,
    phone: contacts.phone,
    companyName: contacts.companyName,
    address: contacts.address1,
    city: contacts.city,
    zip: contacts.zip,
    joinedCompanyName: companies.name,
  }).from(orders)
    .leftJoin(contacts, eq(orders.clientContactId, contacts.id))
    .leftJoin(companies, eq(contacts.flookupCode, companies.lookupCode))
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!row) return { client: null, loanNumber: null, escrowNumber: null };

  const client = row.contactId == null ? null : {
    name: row.fullName?.trim()
      || [row.firstName, row.lastName].filter(Boolean).join(' ').trim()
      || null,
    email: row.email,
    phone: row.phone,
    company: row.companyName?.trim() || row.joinedCompanyName || null,
    address: row.address,
    city: row.city,
    zip: row.zip,
  };

  return { client, loanNumber: row.loanNumber, escrowNumber: row.escrowNumber };
}

export async function loadRecipientEmails(
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

  // GATED, AND THE GATE IS THE POINT. This candidate has existed since
  // buildConfirmationRecipients was written and has never resolved for anybody:
  // `order_parties` held zero `buyer_agent` rows for the table's entire history
  // because SoftPro's `BuyersAgentBrokers` was missing from the response type.
  // Mapping that field starts producing the rows, which would silently switch a
  // dormant TO candidate live — and a buyer's agent is typically the opposite
  // side's representative, not the client the confirmation is addressed to.
  // Off unless somebody decides otherwise. See
  // docs/tickets/SOFTPRO_MISSING_BUYER.md §4.
  //
  // `resolveRecipients` gates `order.closed` on the same setting.
  const buyerAgentAllowed = await isBuyerAgentRecipientEnabled();
  const buyerAgent = partyRows.find((r) => r.role === 'buyer_agent');
  const buyerAgentEmail = buyerAgentAllowed
    ? buyerAgent?.cEmail ?? buyerAgent?.externalEmail ?? null
    : null;

  // Loaded by ORDER ID from the stored list. The loader takes no address
  // parameter, so nothing a caller passes can introduce a recipient here.
  const deliverableEmails = await deliverableEmailsForSend(orderId);

  return buildConfirmationRecipients({
    clientEmail,
    escrowOfficerEmail,
    listingAgentEmail,
    buyerAgentEmail,
    salesRepEmail: row.srEmail,
    internalCcEmails: process.env.PCT_INTERNAL_CC_EMAILS ?? null,
    deliverableEmails,
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

/**
 * What the email carried, recorded as three separate facts.
 *
 * `eligible` is what existed in `documents` when we looked. `attached` is what
 * actually went into the message. `dropped` is the difference — a row that
 * existed and did not make it, which today means its S3 download failed.
 *
 * Kept apart rather than collapsed into a count, because "we had nothing to
 * send" and "we had it and lost it" are different failures with different
 * fixes, and a single number cannot tell them apart afterwards.
 */
export interface ConfirmationAttachmentRecord {
  attached: string[];
  eligible: string[];
  dropped: string[];
  filenames: string[];
  outstanding: boolean;
}

/**
 * Pure so it can be tested without a database or an S3 bucket. `dropped` is
 * the whole point of the record and it is a derived value, so it is derived in
 * one place rather than assembled at the call site.
 */
export function buildAttachmentRecord(args: {
  presentCategories: readonly string[];
  attachedCategories: readonly string[];
  filenames: readonly string[];
  outstanding: boolean;
}): ConfirmationAttachmentRecord {
  const eligible = CONFIRMATION_DOC_TYPES.filter((cat) => args.presentCategories.includes(cat));
  return {
    attached: [...args.attachedCategories],
    eligible: [...eligible],
    dropped: eligible.filter((cat) => !args.attachedCategories.includes(cat)),
    filenames: [...args.filenames],
    outstanding: args.outstanding,
  };
}

async function buildAttachments(
  orderId: number,
): Promise<{
  attachments: SendGridAttachment[];
  labels: string[];
  outstanding: boolean;
  record: ConfirmationAttachmentRecord;
}> {
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
  const attachedCategories: string[] = [];
  const order = CONFIRMATION_DOC_TYPES;

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
        labels.push(CONFIRMATION_DOC_LABELS[cat] ?? cat);
        attachedCategories.push(cat);
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
  // Outstanding is decided on what ACTUALLY ATTACHED, not on what exists in the
  // documents table — a row whose S3 download failed is not in this email, so
  // from the customer's side it is still coming.
  const outstanding = hasOutstandingDocuments(attachedCategories);

  return {
    attachments,
    labels,
    outstanding,
    record: buildAttachmentRecord({
      presentCategories: docRows.map((d) => d.category),
      attachedCategories,
      filenames: attachments.map((a) => a.filename),
      outstanding,
    }),
  };
}
