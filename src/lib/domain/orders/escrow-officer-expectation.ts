import { sql, type SQL } from 'drizzle-orm';

// PCT handles escrow in-house for these order types, so a PCT escrow officer is expected.
// Verified May 2026: Title & Escrow 404/468 (86%) and Escrow only 8/11 (73%) carry an EO.
// Title only = external escrow (no PCT EO); Trustee Sale Guarantee = guarantee product (no EO).
export const PCT_ESCROW_OFFICER_ORDER_TYPES = ['Title & Escrow', 'Escrow only'] as const;

export function expectsPctEscrowOfficer(orderType: string | null | undefined): boolean {
  return PCT_ESCROW_OFFICER_ORDER_TYPES.some((expected) => expected === orderType);
}

export function expectsPctEscrowOfficerSql(orderTypeColumn: SQL<unknown>): SQL<unknown> {
  return sql`${orderTypeColumn} in (${sql.join(
    PCT_ESCROW_OFFICER_ORDER_TYPES.map((orderType) => sql`${orderType}`),
    sql`, `,
  )})`;
}

export function missingExpectedEscrowOfficerSql(
  orderTypeColumn: SQL<unknown>,
  escrowOfficerIdColumn: SQL<unknown>,
): SQL<unknown> {
  return sql`${escrowOfficerIdColumn} is null and ${expectsPctEscrowOfficerSql(orderTypeColumn)}`;
}
