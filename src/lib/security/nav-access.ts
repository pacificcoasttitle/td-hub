/**
 * Which sidebar paths each role is shown.
 *
 * ─── WHY THIS IS NOT IN THE LAYOUT ANY MORE ─────────────────────────────────
 *
 * It lived in `src/app/(admin)/layout.tsx`, where nothing could import it, so
 * nothing could test it. On 2026-09-17 `/reports` shipped with a sidebar entry
 * and no path here: the link rendered for NOBODY, and the page was reachable
 * only by typing the URL. The nav test asserted the entry existed and sat after
 * Documents — both true, and both useless.
 *
 * Moved here so `sidebar-nav.test.ts` can assert the thing that actually
 * matters: every nav entry is visible to at least one role.
 *
 * ─── WHAT THIS IS AND IS NOT ────────────────────────────────────────────────
 *
 * This decides what is DRAWN. It is not the permission model: every page and
 * every route re-checks the session itself. Hiding a link protects nothing —
 * but a link nobody can see hides a working feature, which is its own failure.
 */
export const NAV_BY_ROLE: Record<string, string[]> = {
  // /reports is shown to the roles that can create one: the nine
  // open_order_team operators, plus admin and super_admin. See
  // CONCIERGE_GENERATE_ROLES in lib/domain/concierge/access.ts.
  super_admin: ['/dashboard', '/hub', '/orders', '/contacts', '/documents', '/reports', '/jobs', '/settings', '/notifications', '/users'],
  admin:       ['/dashboard', '/hub', '/orders', '/contacts', '/documents', '/reports', '/jobs', '/settings', '/notifications', '/users'],
  cs_admin:    ['/dashboard', '/hub', '/orders', '/contacts', '/documents', '/jobs'],
  title_officer:   ['/dashboard', '/orders', '/documents'],
  escrow_officer:  ['/dashboard', '/orders', '/documents'],
  open_order_team: ['/hub', '/orders', '/contacts', '/reports'],
  escrow_assistant: ['/hub', '/orders', '/contacts'],
  title_production: ['/title-production'],
};

/** The roles the admin shell admits at all. */
export const ADMIN_SHELL_ROLES = Object.keys(NAV_BY_ROLE);
