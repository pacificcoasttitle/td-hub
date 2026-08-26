import { eq, inArray, type SQL } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { contacts, orders } from '@/lib/db/schema';
import { getManagedRepIds } from '@/lib/domain/contacts/managed-reps';

// ─── Row-level scope for the orders list ─────────────────────────────────────
//
// Extracted from /api/orders so the queue-count endpoint can apply the exact
// same predicate. If the counts were unscoped a sales rep would see "7,300" on
// the ALL tile and twelve rows in the list — and would reasonably conclude the
// list was broken.

export const FULL_ACCESS_ROLES = ['super_admin', 'admin', 'cs_admin', 'open_order_team'];

export interface ScopeSession {
  id: string;
  role: string;
  contactId: number | null;
  email: string;
}

/** No contact record means no rows — never means no filter. */
const NOTHING: SQL = eq(orders.id, -1);

async function resolveContactId(session: Pick<ScopeSession, 'contactId' | 'email'>): Promise<number | null> {
  if (session.contactId) return session.contactId;
  const [row] = await db.select({ id: contacts.id }).from(contacts)
    .where(eq(contacts.email, session.email)).limit(1);
  return row?.id ?? null;
}

export async function buildScopeFilter(session: ScopeSession): Promise<SQL | null> {
  if (FULL_ACCESS_ROLES.includes(session.role)) return null;

  if (session.role === 'sales_rep') {
    const cid = await resolveContactId(session);
    if (!cid) return NOTHING;
    return eq(orders.salesRepId, cid);
  }

  if (session.role === 'sales_manager') {
    const cid = await resolveContactId(session);
    if (!cid) return NOTHING;
    const managedIds = await getManagedRepIds(cid);
    return inArray(orders.salesRepId, [cid, ...managedIds]);
  }

  if (session.role === 'title_officer') {
    const cid = await resolveContactId(session);
    if (!cid) return NOTHING;
    return eq(orders.titleOfficerId, cid);
  }

  if (session.role === 'escrow_officer') {
    const cid = await resolveContactId(session);
    if (!cid) return NOTHING;
    return eq(orders.escrowOfficerId, cid);
  }

  if (session.role === 'escrow_assistant') {
    return inArray(orders.orderType, ['Title & Escrow', 'Escrow only']);
  }

  if (session.role === 'client') {
    return eq(orders.createdBy, session.id);
  }

  return NOTHING;
}
