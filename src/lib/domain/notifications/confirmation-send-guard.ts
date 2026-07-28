import { db } from '@/lib/db/client';
import { orders } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

/** Loud status when confirmation sends without the form's client recipient. Fits email_status varchar(20). */
export const EMAIL_STATUS_SENT_NO_CLIENT = 'sent_no_client';

const SENT_STATUSES = new Set(['sent', EMAIL_STATUS_SENT_NO_CLIENT]);

/** True when orders.email_status already reflects a successful confirmation send. */
export async function hasConfirmationEmailStatus(orderId: number): Promise<boolean> {
  const [row] = await db
    .select({ emailStatus: orders.emailStatus })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  return SENT_STATUSES.has(row?.emailStatus ?? '');
}
