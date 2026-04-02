import { db } from '@/lib/db/client';
import { contacts } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

/**
 * Returns an array of contact IDs for sales reps managed by the given manager.
 * Used to scope dashboard data for the sales_manager role.
 */
export async function getManagedRepIds(managerContactId: number): Promise<number[]> {
  const rows = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.managerId, managerContactId), eq(contacts.isSalesRep, true)));
  return rows.map((r) => r.id);
}
