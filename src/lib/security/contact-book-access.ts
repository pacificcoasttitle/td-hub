/**
 * Who may read the master contact and company book.
 *
 * ─── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * Until 2026-09-14 six read endpoints returned the book to ANY logged-in
 * session: `GET /api/contacts`, `/api/contacts/[id]`, `/api/contacts/[id]/manager`,
 * `/api/companies`, `/api/companies/[id]` and `/api/companies/near-match`.
 * Middleware only checks that a user is logged in, never the role. So a client
 * account on the portal could page through all 21,797 contacts — 19,144 with
 * an email — and every company, by search or by sequential id.
 *
 * `/api/contacts/search` was the one read that already restricted by role.
 * This is its list, moved here so the seven reads share one definition rather
 * than seven local copies (docs/tickets/ROLE_CONSTANTS_SHARE_NAMES.md counts 35
 * local ALLOWED_ROLES with twelve different contents).
 *
 * ─── WHO IS NOT ON IT, AND WHY THAT IS SAFE TODAY ───────────────────────────
 *
 * `client`: the point.
 * `sales_manager` and `title_production` are internal but were never on the
 * search list. Checked 2026-09-14: the (admin) layout redirects sales managers
 * to /sales and confines title_production to /title-production, and no page
 * either can reach calls these endpoints. Add them here if that changes.
 *
 * The client portal's party step lost its name and company typeahead with
 * this. If it is missed, the replacement suggests only from parties on the
 * client's own orders — never the book.
 */
export const CONTACT_BOOK_READ_ROLES: readonly string[] = [
  'super_admin', 'admin', 'cs_admin', 'open_order_team', 'escrow_assistant',
  'sales_rep', 'title_officer', 'escrow_officer',
];

export function canReadContactBook(role: string): boolean {
  return CONTACT_BOOK_READ_ROLES.includes(role);
}
