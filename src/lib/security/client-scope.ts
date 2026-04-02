import { db } from '@/lib/db/client';
import { profiles, orders, orderParties, contacts } from '@/lib/db/schema';
import { eq, and, or, inArray, sql } from 'drizzle-orm';

const FULL_ACCESS_ROLES = new Set(['super_admin', 'admin', 'cs_admin', 'open_order_team']);
const NO_ORDER_ACCESS_ROLES = new Set(['title_production']);

/**
 * Returns true if the authenticated user is allowed to view the order.
 * Uses a single efficient query per role category.
 */
export async function canAccessOrder(
  userId: string,
  orderId: number,
): Promise<boolean> {
  const [profile] = await db
    .select({ role: profiles.role, contactId: profiles.contactId })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);

  if (!profile) return false;

  if (FULL_ACCESS_ROLES.has(profile.role)) return true;
  if (NO_ORDER_ACCESS_ROLES.has(profile.role)) return false;

  const contactId = profile.contactId;

  if (profile.role === 'client') {
    const [hit] = await db.select({ v: sql<number>`1` }).from(orders).where(
      and(
        eq(orders.id, orderId),
        or(
          eq(orders.createdBy, userId),
          contactId
            ? sql`EXISTS (SELECT 1 FROM order_parties WHERE order_id = ${orderId} AND contact_id = ${contactId})`
            : undefined,
        ),
      ),
    ).limit(1);
    return !!hit;
  }

  if (!contactId) return false;

  if (profile.role === 'sales_rep') {
    const [hit] = await db.select({ v: sql<number>`1` }).from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.salesRepId, contactId)))
      .limit(1);
    return !!hit;
  }

  if (profile.role === 'sales_manager') {
    const managedReps = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.managerId, contactId), eq(contacts.isSalesRep, true)));
    const repIds = [contactId, ...managedReps.map((r) => r.id)];

    const [hit] = await db.select({ v: sql<number>`1` }).from(orders)
      .where(and(eq(orders.id, orderId), inArray(orders.salesRepId, repIds)))
      .limit(1);
    return !!hit;
  }

  if (profile.role === 'title_officer') {
    const [hit] = await db.select({ v: sql<number>`1` }).from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.titleOfficerId, contactId)))
      .limit(1);
    return !!hit;
  }

  if (profile.role === 'escrow_officer') {
    const [hit] = await db.select({ v: sql<number>`1` }).from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.escrowOfficerId, contactId)))
      .limit(1);
    return !!hit;
  }

  return false;
}

/**
 * Returns an array of order IDs the user can access, or null for full-access roles.
 */
export async function getAccessibleOrderIds(
  userId: string,
): Promise<number[] | null> {
  const [profile] = await db
    .select({ role: profiles.role, contactId: profiles.contactId })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);

  if (!profile) return [];
  if (FULL_ACCESS_ROLES.has(profile.role)) return null;
  if (NO_ORDER_ACCESS_ROLES.has(profile.role)) return [];

  const contactId = profile.contactId;

  if (profile.role === 'client') {
    const createdRows = await db.select({ id: orders.id }).from(orders)
      .where(eq(orders.createdBy, userId));
    const partyRows = contactId
      ? await db.select({ orderId: orderParties.orderId }).from(orderParties)
          .where(eq(orderParties.contactId, contactId))
      : [];
    const ids = new Set([
      ...createdRows.map((r) => r.id),
      ...partyRows.map((r) => r.orderId),
    ]);
    return [...ids];
  }

  if (!contactId) return [];

  if (profile.role === 'sales_rep') {
    const rows = await db.select({ id: orders.id }).from(orders)
      .where(eq(orders.salesRepId, contactId));
    return rows.map((r) => r.id);
  }

  if (profile.role === 'sales_manager') {
    const managedReps = await db.select({ id: contacts.id }).from(contacts)
      .where(and(eq(contacts.managerId, contactId), eq(contacts.isSalesRep, true)));
    const repIds = [contactId, ...managedReps.map((r) => r.id)];
    const rows = await db.select({ id: orders.id }).from(orders)
      .where(inArray(orders.salesRepId, repIds));
    return rows.map((r) => r.id);
  }

  if (profile.role === 'title_officer') {
    const rows = await db.select({ id: orders.id }).from(orders)
      .where(eq(orders.titleOfficerId, contactId));
    return rows.map((r) => r.id);
  }

  if (profile.role === 'escrow_officer') {
    const rows = await db.select({ id: orders.id }).from(orders)
      .where(eq(orders.escrowOfficerId, contactId));
    return rows.map((r) => r.id);
  }

  return [];
}
