import { db } from '@/lib/db/client';
import { orders, orderProperties, documents } from '@/lib/db/schema';
import { eq, desc, sql, and, gte, SQL, count as drizzleCount, inArray } from 'drizzle-orm';

type ScopeColumn = typeof orders.salesRepId | typeof orders.titleOfficerId | typeof orders.escrowOfficerId;

// ─── Scoped Order List ──────────────────────────────────────────────────────

export interface ScopedOrderListParams {
  scopeColumn: ScopeColumn;
  contactId: number;
  /** When set (non-empty), scope to any of these contact IDs instead of contactId alone (e.g. manager + team). */
  contactIds?: number[];
  page?: number;
  pageSize?: number;
  status?: string;
}

function scopeWhereClause(
  scopeColumn: ScopeColumn,
  contactId: number,
  contactIds?: number[],
) {
  return contactIds && contactIds.length > 0
    ? inArray(scopeColumn, contactIds)
    : eq(scopeColumn, contactId);
}

export async function getScopedOrders(params: ScopedOrderListParams) {
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 25;
  const offset = (page - 1) * pageSize;

  const conditions: SQL[] = [
    scopeWhereClause(params.scopeColumn, params.contactId, params.contactIds),
  ];
  if (params.status) {
    conditions.push(eq(orders.operationalStatus, params.status as typeof orders.operationalStatus.enumValues[number]));
  }
  const where = and(...conditions);

  const [rows, countResult] = await Promise.all([
    db.select({
      id: orders.id, fileNumber: orders.fileNumber,
      operationalStatus: orders.operationalStatus, transactionType: orders.transactionType,
      productType: orders.productType, orderType: orders.orderType,
      salesPrice: orders.salesPrice, openedAt: orders.openedAt,
      closedAt: orders.closedAt, completedAt: orders.completedAt,
      address: orderProperties.address, city: orderProperties.city,
      state: orderProperties.state, fullAddress: orderProperties.fullAddress,
    })
      .from(orders)
      .leftJoin(orderProperties, eq(orders.id, orderProperties.orderId))
      .where(where)
      .orderBy(desc(orders.openedAt))
      .limit(pageSize)
      .offset(offset),
    db.select({ total: sql<number>`count(*)` }).from(orders).where(where),
  ]);

  return { orders: rows, total: Number(countResult[0]?.total ?? 0), page, pageSize };
}

// ─── Scoped Stats ───────────────────────────────────────────────────────────

export interface ScopedStats {
  assigned: number;
  open: number;
  closedThisMonth: number;
  pipelineValue: number;
}

export async function getScopedStats(
  scopeColumn: ScopeColumn,
  contactId: number,
  options?: { contactIds?: number[] },
): Promise<ScopedStats> {
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
  const where = scopeWhereClause(scopeColumn, contactId, options?.contactIds);

  const [result] = await db.select({
    assigned: sql<number>`count(*)`,
    open: sql<number>`count(*) filter (where ${orders.operationalStatus} in ('open', 'in_process'))`,
    closedThisMonth: sql<number>`count(*) filter (where ${orders.operationalStatus} = 'closed' and ${orders.closedAt} >= ${monthStart})`,
    pipelineValue: sql<number>`coalesce(sum(${orders.salesPrice}::numeric) filter (where ${orders.operationalStatus} in ('open', 'in_process')), 0)`,
  }).from(orders).where(where);

  return {
    assigned: Number(result?.assigned ?? 0),
    open: Number(result?.open ?? 0),
    closedThisMonth: Number(result?.closedThisMonth ?? 0),
    pipelineValue: Number(result?.pipelineValue ?? 0),
  };
}

// ─── Document Stats (for escrow officers) ───────────────────────────────────

export async function getDocumentStats(contactId: number) {
  const scopeWhere = eq(orders.escrowOfficerId, contactId);

  const orderIds = db
    .select({ id: orders.id })
    .from(orders)
    .where(scopeWhere);

  const [result] = await db.select({
    pendingDocuments: sql<number>`count(*) filter (where ${documents.isSyncedToSoftpro} = false)`,
    cplGenerated: sql<number>`count(*) filter (where ${documents.category} = 'cpl')`,
  }).from(documents).where(sql`${documents.orderId} in (${orderIds})`);

  return {
    pendingDocuments: Number(result?.pendingDocuments ?? 0),
    cplGenerated: Number(result?.cplGenerated ?? 0),
  };
}

// ─── TitlePoint Pending (for title officers) ────────────────────────────────

export async function getTitlePointPendingCount(contactId: number): Promise<number> {
  const scopeWhere = eq(orders.titleOfficerId, contactId);

  const [result] = await db.select({
    pending: sql<number>`count(*)`,
  }).from(sql`title_point_data tpd`)
    .innerJoin(orders, sql`${orders.id} = tpd.order_id`)
    .where(and(scopeWhere, sql`tpd.status = 'pending'`));

  return Number(result?.pending ?? 0);
}
