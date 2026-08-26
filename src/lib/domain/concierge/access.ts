// ─── Who may generate a concierge profile, and whether the feature is on ────
//
// TWO INDEPENDENT CONDITIONS, both visible in this file, because the thing that
// used to keep concierge generation inert was an accident.
//
// SITEX_CONCIERGE_FEED_ID was believed unset, so getConciergeFeedId() would
// throw and nothing could run. It has been set in Preview and Production since
// 2026-08-24. That guard does not exist and never did after that date — see
// docs/tickets/CONCIERGE_OPERATOR_UI_NEEDS_ITS_OWN_GATE.md.
//
// "It can't run because a config value is missing" is not a gate. A gate is
// something a reviewer can read in a diff.

/**
 * Generation. Nine `open_order_team` users are the operators — they are the
 * people opening the orders. admin and super_admin are included so the feature
 * can be exercised and supported.
 *
 * Mapped from the roles users ACTUALLY hold, not from the `roles` table, which
 * omits open_order_team entirely. See docs/tickets/ROLES_TABLE_IS_MISLEADING.md.
 */
export const CONCIERGE_GENERATE_ROLES = ['open_order_team', 'admin', 'super_admin'] as const;

/**
 * Usage and credit reporting. Deliberately a different, narrower audience than
 * generation: spend reporting is a management view.
 */
export const CONCIERGE_USAGE_ROLES = ['super_admin', 'admin', 'cs_admin'] as const;

/**
 * The kill switch. Defaults to OFF — an unset or malformed value disables the
 * feature, so a missing variable can never mean "enabled".
 *
 * Checked on the server for every generating route AND used to hide the UI. The
 * UI check alone would be decoration; the server check alone would leave a
 * button that fails.
 */
export function conciergeEnabled(): boolean {
  return (process.env.CONCIERGE_PROFILE_ENABLED ?? '').trim().toLowerCase() === 'true';
}

export function canGenerateConcierge(role: string | null | undefined): boolean {
  return !!role && (CONCIERGE_GENERATE_ROLES as readonly string[]).includes(role);
}

export function canViewConciergeUsage(role: string | null | undefined): boolean {
  return !!role && (CONCIERGE_USAGE_ROLES as readonly string[]).includes(role);
}

export type ConciergeDenial = 'feature_off' | 'role';

/**
 * Both conditions in one place so a route cannot check one and forget the
 * other. Returns null when generation is permitted.
 *
 * Order matters for what the operator is told: a disabled feature is not the
 * user's fault and should not read as "you lack permission".
 */
export function denyConciergeGeneration(role: string | null | undefined): ConciergeDenial | null {
  if (!conciergeEnabled()) return 'feature_off';
  if (!canGenerateConcierge(role)) return 'role';
  return null;
}

export function denialMessage(d: ConciergeDenial): string {
  return d === 'feature_off'
    ? 'Property profiles are not enabled.'
    : 'You do not have permission to generate property profiles.';
}
