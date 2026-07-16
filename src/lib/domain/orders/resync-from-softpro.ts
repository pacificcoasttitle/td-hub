import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { orderProperties, orders } from '@/lib/db/schema';
import { getOrderDetails } from '@/lib/integrations/softpro';
import {
  loadEscrowOfficers,
  loadSalesReps,
  loadTitleOfficers,
  processOrderDetail,
} from '@/lib/domain/orders/process-detail';
import { enrichSingleOrder } from '@/lib/jobs/handlers/enrich-orders';

export interface ResyncChange {
  field: string;
  oldValue: string | null;
  newValue: string | null;
}

export interface ResyncFromSoftProResult {
  success: boolean;
  orderId: number;
  fileNumber: string;
  updated: boolean;
  changes: ResyncChange[];
  partiesWritten: number;
  error?: string;
}

type Snapshot = {
  operationalStatus: string | null;
  softproStatus: string | null;
  transactionType: string | null;
  productType: string | null;
  orderType: string | null;
  salesPrice: string | null;
  salesRepId: number | null;
  titleOfficerId: number | null;
  escrowOfficerId: number | null;
  address: string | null;
  city: string | null;
  state: string | null;
};

async function loadSnapshot(orderId: number): Promise<Snapshot | null> {
  const [row] = await db
    .select({
      operationalStatus: orders.operationalStatus,
      softproStatus: orders.softproStatus,
      transactionType: orders.transactionType,
      productType: orders.productType,
      orderType: orders.orderType,
      salesPrice: orders.salesPrice,
      salesRepId: orders.salesRepId,
      titleOfficerId: orders.titleOfficerId,
      escrowOfficerId: orders.escrowOfficerId,
      address: orderProperties.address,
      city: orderProperties.city,
      state: orderProperties.state,
    })
    .from(orders)
    .leftJoin(orderProperties, eq(orderProperties.orderId, orders.id))
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!row) return null;

  return {
    operationalStatus: row.operationalStatus ?? null,
    softproStatus: row.softproStatus ?? null,
    transactionType: row.transactionType ?? null,
    productType: row.productType ?? null,
    orderType: row.orderType ?? null,
    salesPrice: row.salesPrice ?? null,
    salesRepId: row.salesRepId ?? null,
    titleOfficerId: row.titleOfficerId ?? null,
    escrowOfficerId: row.escrowOfficerId ?? null,
    address: row.address ?? null,
    city: row.city ?? null,
    state: row.state ?? null,
  };
}

function diffSnapshots(before: Snapshot, after: Snapshot): ResyncChange[] {
  const fields: Array<keyof Snapshot> = [
    'operationalStatus',
    'softproStatus',
    'transactionType',
    'productType',
    'orderType',
    'salesPrice',
    'salesRepId',
    'titleOfficerId',
    'escrowOfficerId',
    'address',
    'city',
    'state',
  ];

  const changes: ResyncChange[] = [];
  for (const field of fields) {
    const oldValue = before[field] == null ? null : String(before[field]);
    const newValue = after[field] == null ? null : String(after[field]);
    if (oldValue !== newValue) {
      changes.push({ field, oldValue, newValue });
    }
  }
  return changes;
}

/**
 * Re-pull a single order from SoftPro using the existing GetOrderDetails +
 * processOrderDetail path (same as enrich-order-details / import) and the
 * existing getOrderContacts enrich path for parties/contacts.
 */
export async function resyncFromSoftPro(orderId: number): Promise<ResyncFromSoftProResult> {
  const [order] = await db
    .select({ id: orders.id, fileNumber: orders.fileNumber })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!order) {
    return {
      success: false,
      orderId,
      fileNumber: '',
      updated: false,
      changes: [],
      partiesWritten: 0,
      error: 'Order not found',
    };
  }

  const before = await loadSnapshot(order.id);
  if (!before) {
    return {
      success: false,
      orderId: order.id,
      fileNumber: order.fileNumber,
      updated: false,
      changes: [],
      partiesWritten: 0,
      error: 'Order not found',
    };
  }

  const detailsResult = await getOrderDetails({
    dateFrom: '',
    orderNumber: order.fileNumber,
    orderId: order.id,
  });

  if (!detailsResult.success || !detailsResult.data || detailsResult.data.length === 0) {
    return {
      success: false,
      orderId: order.id,
      fileNumber: order.fileNumber,
      updated: false,
      changes: [],
      partiesWritten: 0,
      error: detailsResult.error?.message ?? 'SoftPro returned no order details',
    };
  }

  const detail = detailsResult.data.find((item) => item.OrderNumber === order.fileNumber)
    ?? detailsResult.data[0];

  if (!detail) {
    return {
      success: false,
      orderId: order.id,
      fileNumber: order.fileNumber,
      updated: false,
      changes: [],
      partiesWritten: 0,
      error: 'SoftPro returned an empty detail list',
    };
  }

  const [salesReps, titleOfficers, escrowOfficers] = await Promise.all([
    loadSalesReps(),
    loadTitleOfficers(),
    loadEscrowOfficers(),
  ]);

  await processOrderDetail(detail, { salesReps, titleOfficers, escrowOfficers });

  const enrich = await enrichSingleOrder(order.id);
  const after = await loadSnapshot(order.id);
  const changes = after ? diffSnapshots(before, after) : [];

  if (enrich.partiesWritten > 0) {
    changes.push({
      field: 'parties',
      oldValue: null,
      newValue: `${enrich.partiesWritten} written`,
    });
  }

  return {
    success: true,
    orderId: order.id,
    fileNumber: order.fileNumber,
    updated: changes.length > 0,
    changes,
    partiesWritten: enrich.partiesWritten,
  };
}
