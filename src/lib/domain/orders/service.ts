import { db } from '@/lib/db/client';
import { orders, orderProperties, orderParties, orderStatusHistory, contacts } from '@/lib/db/schema';
import { eq, desc, sql, ilike, or, and, gte, SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { MappedOrderData } from '@/lib/integrations/softpro';

const salesRepContact = alias(contacts, 'sales_rep');
const titleOfficerContact = alias(contacts, 'title_officer');

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
    salesRepName: string | null;
    titleOfficerName: string | null;
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
      .leftJoin(salesRepContact, eq(orders.salesRepId, salesRepContact.id))
      .leftJoin(titleOfficerContact, eq(orders.titleOfficerId, titleOfficerContact.id))
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
    salesRepName: row.sales_rep?.fullName ?? null,
    titleOfficerName: row.title_officer?.fullName ?? null,
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

export async function getOrderByIdSimple(id: number) {
  const result = await db
    .select()
    .from(orders)
    .where(eq(orders.id, id))
    .limit(1);
  return result[0] ?? null;
}

export async function getOrderByFileNumber(fileNumber: string) {
  const result = await db
    .select()
    .from(orders)
    .where(eq(orders.fileNumber, fileNumber))
    .limit(1);

  return result[0] ?? null;
}

// ─── Transaction Type Validation ─────────────────────────────────────────────

const VALID_TRANSACTION_TYPES = ['Purchase', 'Refinance', 'Equity', 'Other'] as const;
type TransactionType = (typeof VALID_TRANSACTION_TYPES)[number];

function validTransactionType(value: string | null): TransactionType | null {
  if (!value) return null;
  if ((VALID_TRANSACTION_TYPES as readonly string[]).includes(value)) {
    return value as TransactionType;
  }
  return null;
}

async function resolveContactByOfficerName(name: string | null): Promise<number | null> {
  if (!name) return null;
  const result = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(eq(contacts.officerName, name))
    .limit(1);
  return result[0]?.id ?? null;
}

// ─── Upsert from SoftPro ────────────────────────────────────────────────────

export async function upsertFromSoftPro(
  mapped: MappedOrderData
): Promise<{ created: boolean; orderId: number }> {
  const existing = await getOrderByFileNumber(mapped.fileNumber);

  if (!existing) {
    const salesRepId = await resolveContactByOfficerName(mapped.marketingRepName);
    const titleOfficerId = await resolveContactByOfficerName(mapped.titleOfficerName);

    const [newOrder] = await db
      .insert(orders)
      .values({
        fileNumber: mapped.fileNumber,
        operationalStatus: mapped.operationalStatus,
        softproStatus: mapped.softproStatus,
        transactionType: validTransactionType(mapped.transactionType),
        productType: mapped.productType,
        orderType: mapped.orderType,
        salesPrice: mapped.salesPrice,
        salesRepId,
        titleOfficerId,
        openedAt: mapped.openedAt ?? new Date(),
        completedAt: mapped.completedAt,
        closedAt: mapped.closedAt,
        source: 'softpro_sync',
        isImported: true,
        softproLastSyncedAt: new Date(),
      })
      .returning({ id: orders.id });

    await db.insert(orderProperties).values({
      orderId: newOrder!.id,
      address: mapped.property.address,
      city: mapped.property.city,
      state: mapped.property.state,
      county: mapped.property.county,
      fullAddress: mapped.property.fullAddress,
    });

    await db.insert(orderStatusHistory).values({
      orderId: newOrder!.id,
      status: mapped.operationalStatus,
      source: 'softpro_sync',
      notes: 'Initial sync from SoftPro',
    });

    return { created: true, orderId: newOrder!.id };
  }

  const statusChanged = existing.operationalStatus !== mapped.operationalStatus;

  await db
    .update(orders)
    .set({
      softproStatus: mapped.softproStatus,
      operationalStatus: mapped.operationalStatus,
      completedAt: mapped.completedAt ?? existing.completedAt,
      closedAt: mapped.closedAt ?? existing.closedAt,
      salesPrice: mapped.salesPrice ?? existing.salesPrice,
      softproLastSyncedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(orders.id, existing.id));

  if (statusChanged) {
    await db.insert(orderStatusHistory).values({
      orderId: existing.id,
      status: mapped.operationalStatus,
      source: 'softpro_sync',
      notes: `Status changed from ${existing.operationalStatus} to ${mapped.operationalStatus}`,
    });
  }

  return { created: false, orderId: existing.id };
}

// ─── Dashboard Stats ────────────────────────────────────────────────────────

export interface OrderStats {
  total: number; open: number; closed: number;
  closedThisMonth: number; avgDaysToClose: number | null;
}

export async function getOrderStats(): Promise<OrderStats> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [result] = await db
    .select({
      total: sql<number>`count(*)`,
      open: sql<number>`count(*) filter (where ${orders.operationalStatus} = 'open')`,
      closed: sql<number>`count(*) filter (where ${orders.operationalStatus} = 'closed')`,
      closedThisMonth: sql<number>`count(*) filter (where ${orders.operationalStatus} = 'closed' and ${orders.closedAt} >= ${monthStart})`,
      avgDaysToClose: sql<number | null>`avg(extract(epoch from (${orders.closedAt} - ${orders.openedAt})) / 86400) filter (where ${orders.operationalStatus} = 'closed' and ${orders.closedAt} is not null)`,
    })
    .from(orders);

  return {
    total: Number(result?.total ?? 0),
    open: Number(result?.open ?? 0),
    closed: Number(result?.closed ?? 0),
    closedThisMonth: Number(result?.closedThisMonth ?? 0),
    avgDaysToClose: result?.avgDaysToClose != null ? Math.round(Number(result.avgDaysToClose) * 10) / 10 : null,
  };
}

// ─── Recent Activity ────────────────────────────────────────────────────────

export interface RecentActivityItem {
  id: number; orderId: number; fileNumber: string;
  status: string; source: string; notes: string | null; changedAt: Date;
}

export async function getRecentActivity(limit = 20): Promise<RecentActivityItem[]> {
  const rows = await db
    .select({
      id: orderStatusHistory.id,
      orderId: orderStatusHistory.orderId,
      fileNumber: orders.fileNumber,
      status: orderStatusHistory.status,
      source: orderStatusHistory.source,
      notes: orderStatusHistory.notes,
      changedAt: orderStatusHistory.changedAt,
    })
    .from(orderStatusHistory)
    .innerJoin(orders, eq(orderStatusHistory.orderId, orders.id))
    .orderBy(desc(orderStatusHistory.changedAt))
    .limit(limit);

  return rows;
}
