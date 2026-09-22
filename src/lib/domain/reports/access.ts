/**
 * Who may create and open farming reports.
 *
 * The roles the Reports page is shown to (lib/security/nav-access.ts): the
 * open_order_team operators, admin and super_admin. Legacy limited creation to
 * "master" users; these are the hub's equivalent.
 *
 * Separate from CONCIERGE_GENERATE_ROLES on purpose, though the lists match
 * today: a farming report costs nothing and a profile costs a credit, and the
 * two may reasonably diverge. There is no feature flag here for the same
 * reason — the flag exists to stop spending.
 *
 * This decides what routes allow. Hiding a button is not a permission model.
 */
export const FARMING_REPORT_ROLES = ['open_order_team', 'admin', 'super_admin'] as const;

export function canGenerateFarming(role: string | null | undefined): boolean {
  return !!role && (FARMING_REPORT_ROLES as readonly string[]).includes(role);
}
