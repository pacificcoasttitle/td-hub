/**
 * Client-portal access scoping.
 *
 * TODO: Implement proper scoping once real client accounts exist.
 * Correct logic: look up the user's profile.contactId, then check
 * whether that contactId appears in orders.salesRepId,
 * orders.titleOfficerId, orders.escrowOfficerId, or as a row in
 * order_parties for the given orderId.  For now, all authenticated
 * users can see all orders.
 */

/**
 * Returns true if the authenticated user is allowed to view the order.
 * Currently permissive — tighten via contactId → order_parties lookup
 * when client accounts are onboarded.
 */
export async function canAccessOrder(
  _userId: string,
  _orderId: number
): Promise<boolean> {
  // TODO: Replace with real scoping:
  //   1. db.select({ contactId: profiles.contactId }).from(profiles).where(eq(profiles.id, userId))
  //   2. If no contactId, deny (or allow for admin roles)
  //   3. Check orders.salesRepId / titleOfficerId / escrowOfficerId === contactId
  //   4. OR check order_parties where orderId AND contactId match
  return true;
}

/**
 * Returns an array of order IDs the user can access.
 * Used by the client order list to scope results.
 * Currently returns null (no filter = all orders).
 */
export async function getAccessibleOrderIds(
  _userId: string
): Promise<number[] | null> {
  // TODO: When scoping is implemented, query order_parties + orders
  // for the user's contactId and return the matching orderIds.
  // Returning null means "no filter applied" (all orders visible).
  return null;
}
