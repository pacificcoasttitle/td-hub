import { db } from '@/lib/db/client';
import {
  orders, orderProperties, orderParties, contacts,
  profiles, documents, titlePointData, vendorApiLogs,
  notificationLogs,
} from '@/lib/db/schema';
import { eq, and, inArray, desc } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { sendEmail, type SendGridAttachment } from '@/lib/integrations/sendgrid/client';
import { downloadFile } from '@/lib/integrations/s3/client';
import { getSetting } from '@/lib/domain/settings/service';
import {
  orderConfirmationTemplate,
  type ConfirmationParty,
  type ConfirmationTaxData,
} from './confirmation-template';

const salesRepContact = alias(contacts, 'sales_rep');
const titleOfficerContact = alias(contacts, 'title_officer');

function cName(c: { fullName: string | null; officerName: string | null; firstName: string | null; lastName: string | null } | null): string | null {
  if (!c) return null;
  return c.fullName ?? c.officerName ?? ([c.firstName, c.lastName].filter(Boolean).join(' ') || null);
}

export async function handleOrderConfirmation(
  orderId: number,
  payload: Record<string, unknown> | null,
): Promise<void> {
  const noDocuments = payload?.noDocuments === true;
  const testOverride = typeof payload?.testOverrideTo === 'string' ? payload.testOverrideTo.trim() : '';

  const [row] = await db
    .select({
      fileNumber: orders.fileNumber,
      transactionType: orders.transactionType,
      productType: orders.productType,
      salesPrice: orders.salesPrice,
      loanAmount: orders.loanAmount,
      createdBy: orders.createdBy,
      escrowOfficerId: orders.escrowOfficerId,
      lenderId: orders.lenderId,
      listingAgentId: orders.listingAgentId,
      propAddress: orderProperties.address,
      propCity: orderProperties.city,
      propState: orderProperties.state,
      propZip: orderProperties.zip,
      propCounty: orderProperties.county,
      propApn: orderProperties.apn,
      propLegal: orderProperties.legalDescription,
      propPrimaryOwner: orderProperties.primaryOwner,
      propSecondaryOwner: orderProperties.secondaryOwner,
      srEmail: salesRepContact.email,
      srFullName: salesRepContact.fullName,
      srOfficerName: salesRepContact.officerName,
      srFirst: salesRepContact.firstName,
      srLast: salesRepContact.lastName,
      toFullName: titleOfficerContact.fullName,
      toOfficerName: titleOfficerContact.officerName,
      toFirst: titleOfficerContact.firstName,
      toLast: titleOfficerContact.lastName,
    })
    .from(orders)
    .leftJoin(orderProperties, eq(orders.id, orderProperties.orderId))
    .leftJoin(salesRepContact, eq(orders.salesRepId, salesRepContact.id))
    .leftJoin(titleOfficerContact, eq(orders.titleOfficerId, titleOfficerContact.id))
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!row) throw new Error(`Order ${orderId} not found`);

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

  const opener = await loadOpener(row.createdBy);
  const recipientEmails = await loadRecipientEmails(orderId, row, partyRows);
  const taxData = await loadTaxData(orderId);
  const legalDescription = await loadLegalDescription(orderId, row.propLegal);
  const tpShutOff = (await getSetting('titlepoint_shut_off')) === 'true';

  const attachments = await buildAttachments(orderId, noDocuments);

  const { subject, html } = orderConfirmationTemplate({
    fileNumber: row.fileNumber,
    address: [row.propAddress, row.propCity, row.propState, row.propZip].filter(Boolean).join(', ') || null,
    transactionType: row.transactionType,
    productType: row.productType,
    salesPrice: row.salesPrice,
    loanAmount: row.loanAmount,
    opener,
    property: { address: row.propAddress, city: row.propCity, zip: row.propZip, county: row.propCounty, apn: row.propApn, legalDescription },
    taxData,
    seller: { primary: row.propPrimaryOwner, secondary: row.propSecondaryOwner },
    parties: { buyerAgent: toParty('buyer_agent'), listingAgent: toParty('listing_agent'), lender: toParty('lender'), escrow: toParty('escrow_company') },
    assignments: {
      salesRep: cName({ fullName: row.srFullName, officerName: row.srOfficerName, firstName: row.srFirst, lastName: row.srLast }),
      titleOfficer: cName({ fullName: row.toFullName, officerName: row.toOfficerName, firstName: row.toFirst, lastName: row.toLast }),
    },
    hasDocuments: attachments.length > 0,
    isTitlePointActive: !tpShutOff,
  });

  const fromEmail = process.env.OPEN_ORDERS_FROM_EMAIL ?? process.env.FROM_EMAIL ?? 'openorders@pct.com';
  const { dedupedTo, dedupedCc } = recipientEmails;
  const finalTo = testOverride ? [testOverride] : dedupedTo;
  const finalCc = testOverride ? [] : dedupedCc;

  if (finalTo.length === 0) {
    await db.update(orders).set({ emailStatus: 'no_recipients', updatedAt: new Date() }).where(eq(orders.id, orderId));
    return;
  }

  const result = await sendEmail({
    to: finalTo,
    cc: finalCc.length > 0 ? finalCc : undefined,
    subject, html, from: fromEmail,
    attachments: attachments.length > 0 ? attachments : undefined,
  });

  const status = result.success ? 'sent' : 'failed';
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
        errorMessage: result.error?.message ?? null,
        sentAt: result.success ? new Date() : null,
      });
    }
  } catch { /* notification logging must never break the send flow */ }

  if (!result.success) throw new Error(result.error?.message ?? 'Email send failed');
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
  row: { escrowOfficerId: number | null; lenderId: number | null; listingAgentId: number | null; srEmail: string | null },
  partyRows: Array<{ role: string; externalEmail: string | null; cEmail: string | null }>,
) {
  const contactEmails = await Promise.all(
    [row.escrowOfficerId, row.listingAgentId].filter(Boolean).map(async (id) => {
      const [c] = await db.select({ email: contacts.email }).from(contacts).where(eq(contacts.id, id!)).limit(1);
      return c?.email ?? null;
    }),
  );

  const toEmails: string[] = [...contactEmails.filter(Boolean) as string[]];
  const buyerAgent = partyRows.find((r) => r.role === 'buyer_agent');
  if (buyerAgent?.cEmail ?? buyerAgent?.externalEmail) toEmails.push((buyerAgent!.cEmail ?? buyerAgent!.externalEmail)!);

  const ccEmails: string[] = [];
  if (row.srEmail) ccEmails.push(row.srEmail);
  const internalCc = process.env.PCT_INTERNAL_CC_EMAILS;
  if (internalCc) internalCc.split(',').map((e) => e.trim()).filter(Boolean).forEach((e) => ccEmails.push(e));

  const dedupedTo = [...new Set(toEmails.filter(Boolean))];
  const dedupedCc = [...new Set(ccEmails.filter(Boolean))].filter((e) => !dedupedTo.includes(e));
  return { dedupedTo, dedupedCc };
}

async function loadTaxData(orderId: number): Promise<ConfirmationTaxData | null> {
  const [taxRow] = await db.select({ metadata: titlePointData.metadata })
    .from(titlePointData)
    .where(and(
      eq(titlePointData.orderId, orderId),
      eq(titlePointData.searchType, 'tax'),
      eq(titlePointData.status, 'completed'),
    ))
    .orderBy(desc(titlePointData.createdAt), desc(titlePointData.id))
    .limit(1);
  if (!taxRow) return null;

  const meta = (taxRow.metadata as Record<string, unknown>) ?? {};
  const rd = (meta.resultData as Record<string, unknown>) ?? {};
  const str = (obj: Record<string, unknown>, ...keys: string[]) => {
    for (const k of keys) { const v = obj[k]; if (typeof v === 'string' && v.trim()) return v.trim(); }
    return null;
  };
  const obj = (o: Record<string, unknown>, ...keys: string[]) => {
    for (const k of keys) { const v = o[k]; if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>; }
    return null;
  };
  const report = obj(rd, 'TaxReport', 'taxReport') ?? rd;
  const pickInstallment = (source: Record<string, unknown>, ordinal: '1st' | '2nd') => {
    const installments = obj(source, 'Installments', 'installments');
    if (!installments) return null;
    const rawItems = installments.Item ?? installments.items;
    const items = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];
    const match = items.find((item) => {
      if (!item || typeof item !== 'object') return false;
      const number = str(item as Record<string, unknown>, 'Number', 'number');
      return number === ordinal;
    });
    return match && typeof match === 'object' && !Array.isArray(match)
      ? (match as Record<string, unknown>)
      : null;
  };

  return {
    taxRateArea: str(report, 'TaxRateArea', 'taxRateArea'),
    useCode: str(report, 'UseCode', 'useCode'),
    regionCode: str(report, 'RegionCode', 'regionCode'),
    floodZone: str(report, 'FloodZone', 'floodZone'),
    zoningCode: str(report, 'ZoningCode', 'zoningCode'),
    taxRate: str(report, 'TaxRate', 'taxRate'),
    issueDate: str(report, 'IssueDate', 'issueDate'),
    landValue: str(report, 'LandValue', 'landValue', 'LandValuation', 'landValuation'),
    improvementsValue: str(report, 'ImprovementsValue', 'improvementsValue', 'ImprovementsValuation', 'improvementsValuation'),
    firstInstallment: (pickInstallment(report, '1st') ?? obj(report, 'FirstInstallment', 'firstInstallment')) as ConfirmationTaxData['firstInstallment'],
    secondInstallment: (pickInstallment(report, '2nd') ?? obj(report, 'SecondInstallment', 'secondInstallment')) as ConfirmationTaxData['secondInstallment'],
  };
}

async function loadLegalDescription(orderId: number, fallback: string | null): Promise<string | null> {
  const [lvRow] = await db.select({ metadata: titlePointData.metadata })
    .from(titlePointData)
    .where(and(
      eq(titlePointData.orderId, orderId),
      eq(titlePointData.searchType, 'legal_vesting'),
      eq(titlePointData.status, 'completed'),
    ))
    .orderBy(desc(titlePointData.createdAt), desc(titlePointData.id))
    .limit(1);

  if (!lvRow) return fallback;

  const meta = (lvRow.metadata as Record<string, unknown>) ?? {};
  const result = (meta.resultData as Record<string, unknown>) ?? {};
  for (const key of ['BriefLegal', 'briefLegal', 'LegalDescription', 'legalDescription']) {
    const value = result[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return fallback;
}

async function buildAttachments(orderId: number, noDocuments: boolean): Promise<SendGridAttachment[]> {
  if (noDocuments) return [];
  const docRows = await db.select({ storageKey: documents.storageKey, filename: documents.filename, category: documents.category })
    .from(documents)
    .where(and(eq(documents.orderId, orderId), inArray(documents.category, ['legal_vesting', 'tax', 'grant_deed']), eq(documents.status, 'active')));

  const attachments: SendGridAttachment[] = [];
  for (const doc of docRows) {
    try {
      const result = await downloadFile(doc.storageKey);
      if (result.success && result.data) {
        attachments.push({ content: result.data.toString('base64'), type: 'application/pdf', filename: doc.filename });
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
  return attachments;
}
