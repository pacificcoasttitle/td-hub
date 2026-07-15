import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { documents, orders } from '@/lib/db/schema';

export interface PrelimDeliveryEligibility {
  orderExists: boolean;
  hasPrelim: boolean;
  allowedStatus: boolean;
  blocked: boolean;
  blockReason?: string;
}

const BLOCKED_SOFTPRO_STATUSES = new Set(['canceled', 'cancelled', 'duplicate']);

export async function getPrelimDeliveryEligibility(orderId: number): Promise<PrelimDeliveryEligibility> {
  const [order] = await db
    .select({
      id: orders.id,
      softproStatus: orders.softproStatus,
      operationalStatus: orders.operationalStatus,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!order) {
    return {
      orderExists: false,
      hasPrelim: false,
      allowedStatus: false,
      blocked: true,
      blockReason: `Order ${orderId} not found`,
    };
  }

  const [prelim] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(and(
      eq(documents.orderId, orderId),
      eq(documents.category, 'prelim'),
      eq(documents.status, 'active'),
    ))
    .limit(1);

  const status = (order.softproStatus ?? order.operationalStatus ?? '').toLowerCase().trim();
  const allowedStatus = !BLOCKED_SOFTPRO_STATUSES.has(status);
  const hasPrelim = !!prelim;
  const blockReason = !hasPrelim
    ? 'No active prelim document exists for this order'
    : !allowedStatus
      ? `SoftPro status "${status}" cannot receive prelim delivery`
      : undefined;

  return {
    orderExists: true,
    hasPrelim,
    allowedStatus,
    blocked: !!blockReason,
    blockReason,
  };
}
