import type { SessionUser } from './auth';
import { canAccessOrder as clientCanAccessOrder } from './client-scope';
import { canAccessOrderDetailResource } from './permissions';

/**
 * Document read/write gate for /api/documents/* routes.
 * Clients use client-scope; staff/sales use the DC-2 detail-resource gate.
 */
export async function canAccessDocumentOrder(
  session: SessionUser,
  orderId: number,
): Promise<boolean> {
  if (session.role === 'client') {
    return clientCanAccessOrder(session.id, orderId);
  }
  return canAccessOrderDetailResource(session, orderId);
}
