/**
 * Who may open an order. NOT the admin list — deliberately named apart from it.
 *
 * `open_order_team` is the role that actually does this work: Amna, Shean and
 * Emelio have opened 24 of the 40 hub orders through this route. It is wider
 * than `ADMIN_ROLES` in src/lib/security/auth.ts, which is
 * ['super_admin','admin','cs_admin'] and does NOT include them.
 *
 * Both constants were called ADMIN_ROLES. Reading the name here and attaching
 * the other one's meaning to it produced a scope document claiming
 * open_order_team could not reach this endpoint, and an hour spent chasing a
 * permission defect that does not exist. The names differ now so that the two
 * cannot be confused by anyone reading only one of them.
 *
 * A survey of the rest is in docs/tickets/ROLE_CONSTANTS_SHARE_NAMES.md: 32
 * local ADMIN_ROLES with THREE different contents, and 35 local ALLOWED_ROLES
 * with TWELVE.
 *
 * Shared, rather than local to the create route, because reconcile must be
 * pressable by exactly the people whose create it finishes. A second local copy
 * is how the lists above came to have twelve contents.
 */
export const ORDER_CREATE_ROLES: readonly string[] = ['super_admin', 'admin', 'cs_admin', 'open_order_team', 'escrow_assistant'];
