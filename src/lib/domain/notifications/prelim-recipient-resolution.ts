import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { contacts, orderParties, orders } from '@/lib/db/schema';

export interface PrelimRecipient {
  email: string;
  name: string | null;
  role: string;
}

export interface PrelimCcRecipient extends PrelimRecipient {
  source: 'sales_rep' | 'ad_hoc';
}

export interface PrelimRecipientWarning {
  code: string;
  message: string;
  email?: string;
  role?: string;
  source?: PrelimCcRecipient['source'] | 'primary';
}

export interface PrelimAdHocRecipient {
  email: string;
  name?: string | null;
  role?: string | null;
}

export interface PrelimRecipientResolution {
  to: PrelimRecipient | null;
  cc: PrelimCcRecipient[];
  warnings: PrelimRecipientWarning[];
  blocked: boolean;
  blockReason?: string;
}

interface ContactRecipientRow {
  email: string | null;
  fullName: string | null;
}

interface EscrowPartyRow {
  externalName: string | null;
  externalCompany: string | null;
  externalEmail: string | null;
  contactEmail: string | null;
  contactName: string | null;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isValidEmail(email: string | null | undefined): email is string {
  return Boolean(email && EMAIL_PATTERN.test(email.trim()));
}

function invalidEmailWarning(
  role: string,
  email: string | null | undefined,
  source: PrelimRecipientWarning['source'],
): PrelimRecipientWarning {
  return {
    code: 'invalid_email',
    message: `Invalid email for ${role}`,
    email: email ?? undefined,
    role,
    source,
  };
}

async function getContactRecipient(contactId: number): Promise<ContactRecipientRow | null> {
  const [contact] = await db
    .select({
      email: contacts.email,
      fullName: contacts.fullName,
    })
    .from(contacts)
    .where(eq(contacts.id, contactId))
    .limit(1);

  return contact ?? null;
}

async function getEscrowCompanyParty(orderId: number): Promise<EscrowPartyRow | null> {
  const [party] = await db
    .select({
      externalName: orderParties.externalName,
      externalCompany: orderParties.externalCompany,
      externalEmail: orderParties.externalEmail,
      contactEmail: contacts.email,
      contactName: contacts.fullName,
    })
    .from(orderParties)
    .leftJoin(contacts, eq(orderParties.contactId, contacts.id))
    .where(and(
      eq(orderParties.orderId, orderId),
      eq(orderParties.role, 'escrow_company'),
    ));

  return party ?? null;
}

export async function resolvePrelimRecipients(
  orderId: number,
  adHocRecipients: PrelimAdHocRecipient[] = [],
): Promise<PrelimRecipientResolution> {
  const warnings: PrelimRecipientWarning[] = [];
  const [order] = await db
    .select({
      id: orders.id,
      escrowOfficerId: orders.escrowOfficerId,
      salesRepId: orders.salesRepId,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!order) {
    return {
      to: null,
      cc: [],
      warnings,
      blocked: true,
      blockReason: `Order ${orderId} not found`,
    };
  }

  let to: PrelimRecipient | null = null;

  if (order.escrowOfficerId) {
    const escrowOfficer = await getContactRecipient(order.escrowOfficerId);
    if (isValidEmail(escrowOfficer?.email)) {
      to = {
        email: normalizeEmail(escrowOfficer.email),
        name: escrowOfficer.fullName,
        role: 'escrow_officer',
      };
    } else {
      warnings.push(invalidEmailWarning('escrow_officer', escrowOfficer?.email, 'primary'));
    }
  } else {
    const escrowParty = await getEscrowCompanyParty(orderId);
    if (escrowParty?.externalEmail && !isValidEmail(escrowParty.externalEmail)) {
      warnings.push(invalidEmailWarning('escrow_company', escrowParty.externalEmail, 'primary'));
    }

    const primaryEmail = isValidEmail(escrowParty?.externalEmail)
      ? escrowParty.externalEmail
      : escrowParty?.contactEmail;

    if (isValidEmail(primaryEmail)) {
      to = {
        email: normalizeEmail(primaryEmail),
        name: escrowParty?.contactName ?? escrowParty?.externalName ?? escrowParty?.externalCompany ?? null,
        role: 'escrow_company',
      };
    } else if (escrowParty?.contactEmail) {
      warnings.push(invalidEmailWarning('escrow_company', escrowParty.contactEmail, 'primary'));
    }
  }

  if (!to) {
    return {
      to: null,
      cc: [],
      warnings,
      blocked: true,
      blockReason: 'No valid primary prelim recipient resolved',
    };
  }

  const cc: PrelimCcRecipient[] = [];
  const seen = new Set([to.email]);

  const addCc = (
    recipient: PrelimRecipient,
    source: PrelimCcRecipient['source'],
  ) => {
    const email = normalizeEmail(recipient.email);
    if (seen.has(email)) return;
    seen.add(email);
    cc.push({ ...recipient, email, source });
  };

  if (order.salesRepId) {
    const salesRep = await getContactRecipient(order.salesRepId);
    if (isValidEmail(salesRep?.email)) {
      addCc({
        email: salesRep.email,
        name: salesRep.fullName,
        role: 'sales_rep',
      }, 'sales_rep');
    } else {
      warnings.push(invalidEmailWarning('sales_rep', salesRep?.email, 'sales_rep'));
    }
  }

  for (const adHocRecipient of adHocRecipients) {
    if (isValidEmail(adHocRecipient.email)) {
      addCc({
        email: adHocRecipient.email,
        name: adHocRecipient.name ?? null,
        role: adHocRecipient.role ?? 'ad_hoc',
      }, 'ad_hoc');
    } else {
      warnings.push(invalidEmailWarning(adHocRecipient.role ?? 'ad_hoc', adHocRecipient.email, 'ad_hoc'));
    }
  }

  return {
    to,
    cc,
    warnings,
    blocked: false,
  };
}
