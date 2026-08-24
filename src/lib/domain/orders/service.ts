import { db } from '@/lib/db/client';
import { orders, orderProperties, orderParties, orderStatusHistory, contacts, companies, profiles, documents } from '@/lib/db/schema';
import { eq, desc, sql, ilike, or, and, inArray, SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { contactName, projectListRow, type ListRow } from './list-row';
import { SYNC_FAILURE_WINDOW_DAYS } from './hub-queues';
import type { SyncStatus } from './hub-list-row';

const salesRepContact = alias(contacts, 'sales_rep');
const titleOfficerContact = alias(contacts, 'title_officer');
const escrowOfficerContact = alias(contacts, 'escrow_officer');
const clientContact = alias(contacts, 'client_contact');
const lenderContact = alias(contacts, 'lender_contact');
const listingAgentContact = alias(contacts, 'listing_agent');
const titleCompanyAlias = alias(companies, 'title_company');
const underwriterCompanyAlias = alias(companies, 'underwriter_company');
const createdByProfile = alias(profiles, 'created_by_profile');

// ─── Types ───────────────────────────────────────────────────────────────────

export interface OrderListParams {
  page?: number;
  pageSize?: number;
  status?: string;
  search?: string;
  branchId?: number;
  sortBy?: 'openedAt' | 'fileNumber' | 'operationalStatus' | 'salesRep' | 'productType' | 'createdBy';
  sortDir?: 'asc' | 'desc';
}

interface DocCategoryStatus {
  exists: boolean; count: number; latestId: number | null; latestCreatedAt: string | null;
}
interface DocCategoryBool { exists: boolean }
interface OrderDocuments {
  cpl: DocCategoryStatus; prelim: DocCategoryStatus; proposedInsured: DocCategoryStatus;
  legalVesting: DocCategoryBool; tax: DocCategoryBool; grantDeed: DocCategoryBool;
}

export interface OrderListResult {
  orders: ListRow[];
  total: number;
  totalPages: number;
  page: number;
  pageSize: number;
}

// ─── Queries ─────────────────────────────────────────────────────────────────

function orderPartySearchExists(term: string): SQL {
  return sql`exists (
    select 1
    from ${orderParties}
    left join ${contacts} party_contact on ${orderParties.contactId} = party_contact.id
    where ${orderParties.orderId} = ${orders.id}
      and ${orderParties.role} in ('buyer', 'seller', 'lender', 'lender_contact', 'buyer_agent', 'listing_agent')
      and (
        ${orderParties.externalName} ilike ${term}
        or ${orderParties.externalCompany} ilike ${term}
        or party_contact.full_name ilike ${term}
        or party_contact.officer_name ilike ${term}
        or party_contact.company_name ilike ${term}
        or party_contact.email ilike ${term}
      )
  )`;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const SORT_COLUMNS: Record<string, any> = {
  openedAt: orders.openedAt,
  fileNumber: orders.fileNumber,
  operationalStatus: orders.operationalStatus,
  salesRep: salesRepContact.fullName,
  productType: orders.productType,
  createdBy: createdByProfile.displayName,
};
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function getOrders(
  params: OrderListParams = {},
  scopeFilter?: SQL | null,
  extraFilter?: SQL | null,
): Promise<OrderListResult> {
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 25;
  const offset = (page - 1) * pageSize;

  const conditions: SQL[] = [];

  if (scopeFilter) {
    conditions.push(scopeFilter);
  }

  if (extraFilter) {
    conditions.push(extraFilter);
  }

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
        ilike(clientContact.fullName, term),
        ilike(clientContact.email, term),
        ilike(clientContact.companyName, term),
        orderPartySearchExists(term),
      )!
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const sortCol = SORT_COLUMNS[params.sortBy ?? 'openedAt'];
  const orderByClause = params.sortDir === 'asc'
    ? sql`${sortCol} ASC NULLS LAST`
    : sql`${sortCol} DESC NULLS LAST`;

  const openedBySubquery = db
    .select({ orderId: orderParties.orderId, name: orderParties.externalName })
    .from(orderParties)
    .where(and(eq(orderParties.role, 'buyer'), eq(orderParties.isPrimary, true)))
    .as('opened_by');

  const [orderRows, countResult] = await Promise.all([
    db
      .select()
      .from(orders)
      .leftJoin(orderProperties, eq(orders.id, orderProperties.orderId))
      .leftJoin(salesRepContact, eq(orders.salesRepId, salesRepContact.id))
      .leftJoin(titleOfficerContact, eq(orders.titleOfficerId, titleOfficerContact.id))
      .leftJoin(escrowOfficerContact, eq(orders.escrowOfficerId, escrowOfficerContact.id))
      .leftJoin(clientContact, eq(orders.clientContactId, clientContact.id))
      .leftJoin(lenderContact, eq(orders.lenderId, lenderContact.id))
      .leftJoin(listingAgentContact, eq(orders.listingAgentId, listingAgentContact.id))
      .leftJoin(titleCompanyAlias, eq(orders.titleCompanyId, titleCompanyAlias.id))
      .leftJoin(underwriterCompanyAlias, eq(orders.underwriterId, underwriterCompanyAlias.id))
      .leftJoin(createdByProfile, eq(orders.createdBy, createdByProfile.id))
      .leftJoin(openedBySubquery, eq(orders.id, openedBySubquery.orderId))
      .where(where)
      .orderBy(orderByClause)
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)` })
      .from(orders)
      .leftJoin(orderProperties, eq(orders.id, orderProperties.orderId))
      .leftJoin(clientContact, eq(orders.clientContactId, clientContact.id))
      .where(where),
  ]);

  const orderIds = orderRows.map((r) => r.orders.id);
  const [docMap, syncMap] = await Promise.all([
    batchDocumentStatus(orderIds),
    batchSyncStatus(orderIds),
  ]);

  const total = Number(countResult[0]?.count ?? 0);

  const mapped = orderRows.map((row) => projectListRow({
    id: row.orders.id,
    fileNumber: row.orders.fileNumber,
    operationalStatus: row.orders.operationalStatus,
    transactionType: row.orders.transactionType,
    orderType: row.orders.orderType,
    productType: row.orders.productType,
    openedAt: row.orders.openedAt,
    closedAt: row.orders.closedAt,
    salesPrice: row.orders.salesPrice,
    source: row.orders.source,
    emailStatus: row.orders.emailStatus,
    dupOverride: row.orders.dupOverride,
    property: row.order_properties,
    salesRep: row.sales_rep,
    clientContact: row.client_contact,
    clientContactId: row.orders.clientContactId,
    createdByName: row.created_by_profile?.displayName ?? null,
    documents: docMap.get(row.orders.id) ?? emptyDocuments(),
    extras: {
      ...row.orders,
      titleOfficerName: contactName(row.title_officer),
      escrowOfficerName: contactName(row.escrow_officer),
      lenderName: contactName(row.lender_contact),
      listingAgentName: contactName(row.listing_agent),
      titleCompanyName: row.title_company?.name ?? null,
      underwriterName: row.underwriter_company?.name ?? null,
      openedBy: row.opened_by?.name ?? null,
      syncStatus: syncMap.get(row.orders.id) ?? 'synced',
    },
  }));

  return {
    orders: mapped,
    total,
    totalPages: Math.ceil(total / pageSize),
    page,
    pageSize,
  };
}

function emptyDocuments(): OrderDocuments {
  const full = { exists: false, count: 0, latestId: null, latestCreatedAt: null };
  return { cpl: { ...full }, prelim: { ...full }, proposedInsured: { ...full }, legalVesting: { exists: false }, tax: { exists: false }, grantDeed: { exists: false } };
}

// ─── Sync status ─────────────────────────────────────────────────────────────
//
// There is no sync_status column on orders. softpro_last_synced_at is non-null
// on all 7,300 rows, so it cannot distinguish a healthy order from a broken
// one. The vendor call log is the only place a failure is actually recorded.
//
// "Failed" means: a SoftPro or TitlePoint call scoped to this order failed
// inside the window and nothing has succeeded for it since. Measured on
// production, that is 68 orders — a number small enough to act on.
//
// 'pending' is in the union because the spec's data contract names it and the
// UI handles it, but nothing in the current data produces it. It will mean
// something once syncs are queued rather than fired inline; until then no row
// is ever labelled with it.
async function batchSyncStatus(orderIds: number[]): Promise<Map<number, SyncStatus>> {
  const map = new Map<number, SyncStatus>();
  if (orderIds.length === 0) return map;

  const cutoff = sql.raw(`now() - interval '${SYNC_FAILURE_WINDOW_DAYS} days'`);
  const rows = await db.execute<{ order_id: number }>(sql`
    select distinct f.order_id
    from vendor_api_logs f
    where f.order_id in (${sql.join(orderIds.map((id) => sql`${id}`), sql`, `)})
      and f.vendor in ('softpro', 'titlepoint')
      and f.success = false
      and f.created_at > ${cutoff}
      and not exists (
        select 1 from vendor_api_logs s
        where s.order_id = f.order_id
          and s.vendor in ('softpro', 'titlepoint')
          and s.success = true
          and s.created_at > f.created_at
      )
  `);

  for (const r of rows) map.set(Number(r.order_id), 'failed');
  return map;
}

const DOC_CATS = ['cpl', 'prelim', 'proposed_insured', 'legal_vesting', 'tax', 'grant_deed'] as const;

async function batchDocumentStatus(orderIds: number[]): Promise<Map<number, OrderDocuments>> {
  if (orderIds.length === 0) return new Map();
  const rows = await db
    .select({
      orderId: documents.orderId,
      category: documents.category,
      cnt: sql<number>`count(*)`,
      latestId: sql<number | null>`max(${documents.id})`,
      latestAt: sql<string | null>`max(${documents.createdAt})::text`,
    })
    .from(documents)
    .where(and(inArray(documents.orderId, orderIds), eq(documents.status, 'active'), inArray(documents.category, [...DOC_CATS])))
    .groupBy(documents.orderId, documents.category);

  const map = new Map<number, OrderDocuments>();
  for (const r of rows) {
    if (!map.has(r.orderId)) map.set(r.orderId, emptyDocuments());
    const d = map.get(r.orderId)!;
    const cnt = Number(r.cnt);
    const full = { exists: cnt > 0, count: cnt, latestId: r.latestId ? Number(r.latestId) : null, latestCreatedAt: r.latestAt ?? null };
    if (r.category === 'cpl') d.cpl = full;
    else if (r.category === 'prelim') d.prelim = full;
    else if (r.category === 'proposed_insured') d.proposedInsured = full;
    else if (r.category === 'legal_vesting') d.legalVesting = { exists: cnt > 0 };
    else if (r.category === 'tax') d.tax = { exists: cnt > 0 };
    else if (r.category === 'grant_deed') d.grantDeed = { exists: cnt > 0 };
  }
  return map;
}

export async function getOrderById(id: number) {
  const result = await db
    .select()
    .from(orders)
    .leftJoin(orderProperties, eq(orders.id, orderProperties.orderId))
    .leftJoin(createdByProfile, eq(orders.createdBy, createdByProfile.id))
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
    .orderBy(desc(orderStatusHistory.changedAt))
    .limit(200);

  return {
    ...result[0]!.orders,
    createdByName: result[0]!.created_by_profile?.displayName ?? null,
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

// ─── Upsert from SoftPro (extracted to upsert-softpro.ts) ───────────────────
export { upsertFromSoftPro } from './upsert-softpro';

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
