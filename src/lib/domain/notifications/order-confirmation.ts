import { db } from '@/lib/db/client';
import { orders, orderProperties, orderParties, contacts, documents } from '@/lib/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { sendEmail, type SendGridAttachment } from '@/lib/integrations/sendgrid/client';
import { downloadFile } from '@/lib/integrations/s3/client';
import { orderConfirmationTemplate } from './templates';
import { vendorApiLogs } from '@/lib/db/schema';

const escrowOfficerContact = alias(contacts, 'escrow_officer');
const lenderContact = alias(contacts, 'lender_contact');
const listingAgentContact = alias(contacts, 'listing_agent');
const salesRepContact = alias(contacts, 'sales_rep');
const titleOfficerContact = alias(contacts, 'title_officer');

function contactName(c: { fullName: string | null; officerName: string | null; firstName: string | null; lastName: string | null } | null): string | null {
  if (!c) return null;
  if (c.fullName) return c.fullName;
  if (c.officerName) return c.officerName;
  const parts = [c.firstName, c.lastName].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : null;
}

export async function handleOrderConfirmation(
  orderId: number,
  payload: Record<string, unknown> | null,
): Promise<void> {
  const noDocuments = payload?.noDocuments === true;

  const [row] = await db
    .select({
      fileNumber: orders.fileNumber,
      transactionType: orders.transactionType,
      productType: orders.productType,
      propAddress: orderProperties.address,
      propCity: orderProperties.city,
      propState: orderProperties.state,
      propZip: orderProperties.zip,
      eoEmail: escrowOfficerContact.email,
      eoFirstName: escrowOfficerContact.firstName,
      eoLastName: escrowOfficerContact.lastName,
      eoFullName: escrowOfficerContact.fullName,
      eoOfficerName: escrowOfficerContact.officerName,
      lnEmail: lenderContact.email,
      lnFirstName: lenderContact.firstName,
      lnLastName: lenderContact.lastName,
      lnFullName: lenderContact.fullName,
      lnOfficerName: lenderContact.officerName,
      laEmail: listingAgentContact.email,
      laFirstName: listingAgentContact.firstName,
      laLastName: listingAgentContact.lastName,
      laFullName: listingAgentContact.fullName,
      laOfficerName: listingAgentContact.officerName,
      srEmail: salesRepContact.email,
      toFirstName: titleOfficerContact.firstName,
      toLastName: titleOfficerContact.lastName,
      toFullName: titleOfficerContact.fullName,
      toOfficerName: titleOfficerContact.officerName,
    })
    .from(orders)
    .leftJoin(orderProperties, eq(orders.id, orderProperties.orderId))
    .leftJoin(escrowOfficerContact, eq(orders.escrowOfficerId, escrowOfficerContact.id))
    .leftJoin(lenderContact, eq(orders.lenderId, lenderContact.id))
    .leftJoin(listingAgentContact, eq(orders.listingAgentId, listingAgentContact.id))
    .leftJoin(salesRepContact, eq(orders.salesRepId, salesRepContact.id))
    .leftJoin(titleOfficerContact, eq(orders.titleOfficerId, titleOfficerContact.id))
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!row) throw new Error(`Order ${orderId} not found`);

  const parties = await db
    .select({
      role: orderParties.role,
      externalName: orderParties.externalName,
      externalEmail: orderParties.externalEmail,
    })
    .from(orderParties)
    .where(eq(orderParties.orderId, orderId));

  const buyerParty = parties.find((p) => p.role === 'buyer');
  const sellerParty = parties.find((p) => p.role === 'seller');
  const buyerAgentParty = parties.find((p) => p.role === 'buyer_agent');

  // Resolve TO recipients
  const toEmails: string[] = [];
  if (row.eoEmail) toEmails.push(row.eoEmail);
  if (row.laEmail) toEmails.push(row.laEmail);
  if (buyerAgentParty?.externalEmail) toEmails.push(buyerAgentParty.externalEmail);

  // Resolve CC recipients
  const ccEmails: string[] = [];
  if (row.srEmail) ccEmails.push(row.srEmail);
  const internalCc = process.env.PCT_INTERNAL_CC_EMAILS;
  if (internalCc) {
    internalCc.split(',').map((e) => e.trim()).filter(Boolean).forEach((e) => ccEmails.push(e));
  }

  const dedupedTo = [...new Set(toEmails.filter(Boolean))];
  const dedupedCc = [...new Set(ccEmails.filter(Boolean))].filter((e) => !dedupedTo.includes(e));

  if (dedupedTo.length === 0) {
    await db.update(orders).set({ emailStatus: 'no_recipients', updatedAt: new Date() }).where(eq(orders.id, orderId));
    return;
  }

  // Build attachments from S3
  const attachments: SendGridAttachment[] = [];
  if (!noDocuments) {
    const docRows = await db
      .select({ storageKey: documents.storageKey, filename: documents.filename, category: documents.category })
      .from(documents)
      .where(
        and(
          eq(documents.orderId, orderId),
          inArray(documents.category, ['legal_vesting', 'tax', 'grant_deed']),
          eq(documents.status, 'active'),
        )
      );

    for (const doc of docRows) {
      try {
        const result = await downloadFile(doc.storageKey);
        if (result.success && result.data) {
          attachments.push({
            content: result.data.toString('base64'),
            type: 'application/pdf',
            filename: doc.filename,
          });
        }
      } catch {
        try {
          await db.insert(vendorApiLogs).values({
            vendor: 'sendgrid',
            operation: 'confirmation_doc_download_failed',
            orderId,
            requestId: crypto.randomUUID(),
            startedAt: new Date(),
            endedAt: new Date(),
            success: false,
            errorCategory: 'S3_DOWNLOAD',
            requestMeta: { storageKey: doc.storageKey, category: doc.category } as Record<string, unknown>,
          });
        } catch { /* never fail the email send */ }
      }
    }
  }

  const addressParts = [row.propAddress, row.propCity, row.propState, row.propZip].filter(Boolean);
  const { subject, html } = orderConfirmationTemplate({
    fileNumber: row.fileNumber,
    address: addressParts.length > 0 ? addressParts.join(', ') : null,
    transactionType: row.transactionType,
    productType: row.productType,
    buyerName: buyerParty?.externalName ?? null,
    sellerName: sellerParty?.externalName ?? null,
    escrowOfficer: contactName({ fullName: row.eoFullName, officerName: row.eoOfficerName, firstName: row.eoFirstName, lastName: row.eoLastName }),
    lenderName: contactName({ fullName: row.lnFullName, officerName: row.lnOfficerName, firstName: row.lnFirstName, lastName: row.lnLastName }),
    listingAgent: contactName({ fullName: row.laFullName, officerName: row.laOfficerName, firstName: row.laFirstName, lastName: row.laLastName }),
    titleOfficer: contactName({ fullName: row.toFullName, officerName: row.toOfficerName, firstName: row.toFirstName, lastName: row.toLastName }),
    hasDocuments: attachments.length > 0,
  });

  const fromEmail = process.env.OPEN_ORDERS_FROM_EMAIL ?? process.env.FROM_EMAIL ?? 'openorders@pct.com';

  const result = await sendEmail({
    to: dedupedTo,
    cc: dedupedCc.length > 0 ? dedupedCc : undefined,
    subject,
    html,
    from: fromEmail,
    attachments: attachments.length > 0 ? attachments : undefined,
  });

  if (result.success) {
    await db.update(orders).set({ emailStatus: 'sent', updatedAt: new Date() }).where(eq(orders.id, orderId));
  } else {
    await db.update(orders).set({ emailStatus: 'failed', updatedAt: new Date() }).where(eq(orders.id, orderId));
    throw new Error(result.error?.message ?? 'Email send failed');
  }
}
