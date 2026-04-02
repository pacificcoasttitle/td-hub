import { db } from '@/lib/db/client';
import { orders, orderParties, contacts } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export interface Recipient {
  role: string;
  name: string | null;
  email: string | null;
  phone: string | null;
}

const OFFICER_FIELDS = {
  escrow_officer: 'escrowOfficerId',
  sales_rep: 'salesRepId',
  title_officer: 'titleOfficerId',
} as const;

const PARTY_ROLES = new Set([
  'listing_agent', 'buyer_agent', 'lender', 'lender_contact',
  'escrow_company', 'buyer', 'seller', 'borrower', 'other',
]);

export async function resolveRecipients(
  orderId: number,
  recipientRoles: string[] | null,
  internalCc?: string[] | null,
): Promise<Recipient[]> {
  if (!recipientRoles || recipientRoles.length === 0) return [];

  const recipients: Recipient[] = [];
  const seen = new Set<string>();

  const add = (r: Recipient) => {
    const key = r.email?.toLowerCase() ?? r.phone;
    if (!key || seen.has(key)) return;
    seen.add(key);
    recipients.push(r);
  };

  const officerRoles = recipientRoles.filter((r) => r in OFFICER_FIELDS);
  if (officerRoles.length > 0) {
    const [order] = await db
      .select({
        escrowOfficerId: orders.escrowOfficerId,
        salesRepId: orders.salesRepId,
        titleOfficerId: orders.titleOfficerId,
      })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);

    if (order) {
      for (const role of officerRoles) {
        const field = OFFICER_FIELDS[role as keyof typeof OFFICER_FIELDS];
        const contactId = order[field];
        if (!contactId) continue;

        const [c] = await db
          .select({ fullName: contacts.fullName, email: contacts.email, cell: contacts.cell })
          .from(contacts)
          .where(eq(contacts.id, contactId))
          .limit(1);

        if (c?.email) add({ role, name: c.fullName, email: c.email, phone: c.cell });
      }
    }
  }

  const partyRoles = recipientRoles.filter((r) => PARTY_ROLES.has(r));
  if (partyRoles.length > 0) {
    const parties = await db
      .select({
        role: orderParties.role,
        externalName: orderParties.externalName,
        externalEmail: orderParties.externalEmail,
        externalPhone: orderParties.externalPhone,
        cFullName: contacts.fullName,
        cEmail: contacts.email,
        cCell: contacts.cell,
      })
      .from(orderParties)
      .leftJoin(contacts, eq(orderParties.contactId, contacts.id))
      .where(eq(orderParties.orderId, orderId));

    for (const p of parties) {
      if (!partyRoles.includes(p.role)) continue;
      const email = p.cEmail ?? p.externalEmail;
      if (email) {
        add({
          role: p.role,
          name: p.cFullName ?? p.externalName,
          email,
          phone: p.cCell ?? p.externalPhone,
        });
      }
    }
  }

  if (recipientRoles.includes('internal') && internalCc) {
    for (const email of internalCc) {
      if (email?.trim()) {
        add({ role: 'internal', name: null, email: email.trim(), phone: null });
      }
    }
  }

  return recipients;
}
