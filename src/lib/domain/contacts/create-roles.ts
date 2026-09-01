/** Roles that may mint a SoftPro company or person. Hub open-order plus admin. */
export const CREATE_SOFTPRO_ROLES = [
  'super_admin',
  'admin',
  'cs_admin',
  'open_order_team',
] as const;

export function canCreateSoftProRecords(role: string): boolean {
  return (CREATE_SOFTPRO_ROLES as readonly string[]).includes(role);
}
