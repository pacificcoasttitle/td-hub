import { db } from '@/lib/db/client';
import { contacts } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { createAndSendToSoftPro, type CreateOrderResult } from './create-order';
import type { SessionUser } from '@/lib/security/auth';

/**
 * Client version of order creation. Loads the user's contact record
 * and auto-populates personalDetails/contacts from their profile.
 * User-provided fields always win over auto-filled values.
 */
export async function clientCreateOrder(
  raw: Record<string, unknown>,
  session: SessionUser,
  creatorUserId: string = session.id,
): Promise<CreateOrderResult> {
  let contactData: ContactRow | null = null;

  if (session.contactId) {
    const [row] = await db
      .select()
      .from(contacts)
      .where(eq(contacts.id, session.contactId))
      .limit(1);
    contactData = row ?? null;
  }

  const merged = mergeWithContactDefaults(raw, contactData, session);
  return createAndSendToSoftPro(merged, creatorUserId);
}

type ContactRow = typeof contacts.$inferSelect;

/**
 * Merges user input with contact defaults. User-supplied values always win.
 * Auto-fill applies to the escrowCompany contact section (since the submitting
 * client IS the escrow company contact in most flows).
 */
function mergeWithContactDefaults(
  raw: Record<string, unknown>,
  contact: ContactRow | null,
  session: SessionUser,
): Record<string, unknown> {
  if (!contact) return raw;

  const existing = (raw.contacts ?? {}) as Record<string, unknown>;
  const existingEscrow = (existing.escrowCompany ?? {}) as Record<string, unknown>;

  const autoEscrow: Record<string, unknown> = {
    name: buildName(contact),
    email: contact.email ?? session.email,
    phone: contact.phone ?? '',
    companyName: contact.companyName ?? '',
    ...existingEscrow,
  };

  return {
    ...raw,
    contacts: {
      ...existing,
      escrowCompany: autoEscrow,
    },
  };
}

function buildName(contact: ContactRow): string {
  if (contact.fullName) return contact.fullName;
  const parts = [contact.firstName, contact.lastName].filter(Boolean);
  return parts.join(' ') || '';
}
