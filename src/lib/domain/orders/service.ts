import { db } from '@/lib/db/client';
import { orders, orderProperties, orderParties, orderStatusHistory } from '@/lib/db/schema';
import { eq, desc, sql, ilike, or, and, SQL } from 'drizzle-orm';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface OrderListParams {
  page?: number;
  pageSize?: number;
  status?: string;
  search?: string;
  branchId?: number;
}

export interface OrderListResult {
  orders: Array<typeof orders.$inferSelect & {
    property: typeof orderProperties.$inferSelect | null;
  }>;
  total: number;
  page: number;
  pageSize: number;
}

// ─── Queries ─────────────────────────────────────────────────────────────────

export async function getOrders(params: OrderListParams = {}): Promise<OrderListResult> {
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 25;
  const offset = (page - 1) * pageSize;

  const conditions: SQL[] = [];

  if (params.status) {
    conditions.push(eq(orders.operationalStatus, params.status as typeof orders.operationalStatus.enumValues[number]));
  }

  if (params.branchId) {
    conditions.push(eq(orders.branchId, params.branchId));
  }

  if (params.search) {
    const term = `%${params.search}%`;
    conditions.push(
      or(
        ilike(orders.fileNumber, term),
        ilike(orderProperties.address, term),
        ilike(orderProperties.city, term),
      )!
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [orderRows, countResult] = await Promise.all([
    db
      .select()
      .from(orders)
      .leftJoin(orderProperties, eq(orders.id, orderProperties.orderId))
      .where(where)
      .orderBy(desc(orders.openedAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)` })
      .from(orders)
      .leftJoin(orderProperties, eq(orders.id, orderProperties.orderId))
      .where(where),
  ]);

  const mapped = orderRows.map((row) => ({
    ...row.orders,
    property: row.order_properties,
  }));

  return {
    orders: mapped,
    total: Number(countResult[0]?.count ?? 0),
    page,
    pageSize,
  };
}

export async function getOrderById(id: number) {
  const result = await db
    .select()
    .from(orders)
    .leftJoin(orderProperties, eq(orders.id, orderProperties.orderId))
    .where(eq(orders.id, id))
    .limit(1);

  if (result.length === 0) return null;

  const parties = await db
    .select()
    .from(orderParties)
    .where(eq(orderParties.orderId, id));

  const history = await db
    .select()
    .from(orderStatusHistory)
    .where(eq(orderStatusHistory.orderId, id))
    .orderBy(desc(orderStatusHistory.changedAt));

  return {
    ...result[0]!.orders,
    property: result[0]!.order_properties,
    parties,
    statusHistory: history,
  };
}

export async function getOrderByFileNumber(fileNumber: string) {
  const result = await db
    .select()
    .from(orders)
    .where(eq(orders.fileNumber, fileNumber))
    .limit(1);

  return result[0] ?? null;
}
