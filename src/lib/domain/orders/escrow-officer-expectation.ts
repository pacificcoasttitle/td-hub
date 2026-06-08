import { sql, type SQL } from 'drizzle-orm';

export const PCT_ESCROW_OFFICER_ORDER_TYPES = ['Title & Escrow'] as const;

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
