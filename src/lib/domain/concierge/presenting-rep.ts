import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { contacts, orders } from '@/lib/db/schema';

// ─── Who the document says it is from ───────────────────────────────────────
//
// RESOLVED SERVER-SIDE FROM THE ORDER, never accepted from the browser. This is
// the same rule as delivery-by-report-id: a client-facing document must not
// carry a name, email and phone that a page posted. That is exactly the shape
// of the legacy defect where the browser supplied both recipient and
// attachment URL and the server obliged.
//
// The rep is the order's sales rep, not the operator clicking Generate. It is
// their client relationship, the profile goes out under their name, and it
// sidesteps the fact that none of the nine open_order_team users has a contact
// record to draw a phone number from.
//
// THE FALLBACK IS FIRST-CLASS, NOT AN EDGE CASE. orders.sales_rep_id only began
// persisting on 2026-08-26, so it is NULL on everything opened before this
// week — for historical orders "no rep on the order" is the common path, and an
// explicit choice is required rather than a blank line on a client document.

export interface PresentingRep {
  name: string;
  email: string | null;
  phone: string | null;
  title: string | null;
}

export type RepResolution =
  | { ok: true; rep: PresentingRep; source: 'order' | 'override' }
  | { ok: false; reason: 'no_order' | 'no_sales_rep' | 'contact_missing'; message: string };

const clean = (v: string | null | undefined): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

/**
 * @param overrideContactId a contact the operator picked. Required when the
 *        order has no sales rep, and always permitted — the operator can
 *        override the default.
 */
export async function resolvePresentingRep(
  orderId: number | null | undefined,
  overrideContactId?: number | null,
): Promise<RepResolution> {
  if (overrideContactId) {
    const rep = await loadContact(overrideContactId);
    return rep
      ? { ok: true, rep, source: 'override' }
      : { ok: false, reason: 'contact_missing', message: 'That representative could not be found.' };
  }

  if (!orderId) {
    return {
      ok: false, reason: 'no_order',
      message: 'Choose a presenting representative — there is no order to take one from.',
    };
  }

  const [row] = await db.select({ salesRepId: orders.salesRepId })
    .from(orders).where(eq(orders.id, orderId)).limit(1);

  if (!row?.salesRepId) {
    return {
      ok: false, reason: 'no_sales_rep',
      message: 'This order has no sales representative on it. Choose one — the profile goes out under their name.',
    };
  }

  const rep = await loadContact(row.salesRepId);
  return rep
    ? { ok: true, rep, source: 'order' }
    : {
        ok: false, reason: 'contact_missing',
        message: 'The order\'s sales representative has no contact record. Choose one instead.',
      };
}

async function loadContact(id: number): Promise<PresentingRep | null> {
  const [c] = await db.select({
    fullName: contacts.fullName,
    officerName: contacts.officerName,
    email: contacts.email,
    phone: contacts.phone,
  }).from(contacts).where(eq(contacts.id, id)).limit(1);
  if (!c) return null;

  const name = clean(c.fullName) ?? clean(c.officerName);
  // A rep with no name at all cannot present a document.
  if (!name) return null;

  return { name, email: clean(c.email), phone: clean(c.phone), title: 'Sales Representative' };
}
