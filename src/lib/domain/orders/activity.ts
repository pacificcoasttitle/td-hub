import { db } from '@/lib/db/client';
import {
  adminActivityLogs,
  documentAudit,
  documents,
  orderStatusHistory,
  titlePointData,
  vendorApiLogs,
} from '@/lib/db/schema';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { CLIENT_DOCUMENT_CATEGORIES } from './documents';
import type { OrderSubresourceVisibility } from './subresource-visibility';

export type OrderActivityType =
  | 'document'
  | 'status_change'
  | 'vendor_call'
  | 'titlepoint'
  | 'prelim_delivery';

export interface OrderActivityItem {
  type: OrderActivityType;
  timestamp: Date;
  summary: string;
  meta: Record<string, unknown>;
}

const staffCache = new Map<number, { data: OrderActivityItem[]; expiresAt: number }>();
const clientCache = new Map<number, { data: OrderActivityItem[]; expiresAt: number }>();
const CACHE_TTL_MS = 30_000;

/** Test helper — clears in-memory activity caches. */
export function clearOrderActivityCache(): void {
  staffCache.clear();
  clientCache.clear();
}

/**
 * Canonical activity loader.
 * Client policy: document + status only; whitelist doc categories; no staff user ids / vendor internals.
 */
export async function getOrderActivity(
  orderId: number,
  visibility: OrderSubresourceVisibility,
  options?: { limit?: number },
): Promise<{ activity: OrderActivityItem[] }> {
  if (visibility === 'client') {
    return getClientActivity(orderId);
  }
  return getStaffActivity(orderId, options?.limit);
}

async function getClientActivity(orderId: number): Promise<{ activity: OrderActivityItem[] }> {
  const cached = clientCache.get(orderId);
  if (cached && cached.expiresAt > Date.now()) {
    return { activity: cached.data };
  }

  const [docAuditRows, statusRows] = await Promise.all([
    db.select({
      action: documentAudit.action,
      performedAt: documentAudit.performedAt,
      filename: documents.filename,
      category: documents.category,
    })
      .from(documentAudit)
      .innerJoin(documents, and(
        eq(documentAudit.documentId, documents.id),
        eq(documents.orderId, orderId),
        inArray(documents.category, [...CLIENT_DOCUMENT_CATEGORIES]),
      ))
      .orderBy(desc(documentAudit.performedAt))
      .limit(15),

    db.select({
      status: orderStatusHistory.status,
      changedAt: orderStatusHistory.changedAt,
    })
      .from(orderStatusHistory)
      .where(eq(orderStatusHistory.orderId, orderId))
      .orderBy(desc(orderStatusHistory.changedAt))
      .limit(10),
  ]);

  const items: OrderActivityItem[] = [];

  for (const r of docAuditRows) {
    items.push({
      type: 'document',
      timestamp: r.performedAt,
      summary: `${r.action}: ${r.filename ?? 'document'} (${r.category})`,
      meta: { action: r.action, filename: r.filename, category: r.category },
    });
  }

  for (const r of statusRows) {
    items.push({
      type: 'status_change',
      timestamp: r.changedAt,
      summary: `Status updated to ${r.status}`,
      meta: { status: r.status },
    });
  }

  items.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  const result = items.slice(0, 20);

  clientCache.set(orderId, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
  return { activity: result };
}

async function getStaffActivity(
  orderId: number,
  rawLimit?: number,
): Promise<{ activity: OrderActivityItem[] }> {
  const limit = Math.min(rawLimit ?? 30, 100);

  const cached = staffCache.get(orderId);
  if (cached && cached.expiresAt > Date.now()) {
    return { activity: cached.data.slice(0, limit) };
  }

  const [docAuditRows, statusRows, vendorRows, tpRows, prelimDeliveryRows] = await Promise.all([
    db.select({
      action: documentAudit.action,
      performedAt: documentAudit.performedAt,
      byUserId: documentAudit.byUserId,
      meta: documentAudit.meta,
      filename: documents.filename,
      category: documents.category,
    })
      .from(documentAudit)
      .innerJoin(documents, and(
        eq(documentAudit.documentId, documents.id),
        eq(documents.orderId, orderId),
      ))
      .orderBy(desc(documentAudit.performedAt))
      .limit(20),

    db.select({
      status: orderStatusHistory.status,
      source: orderStatusHistory.source,
      notes: orderStatusHistory.notes,
      changedAt: orderStatusHistory.changedAt,
    })
      .from(orderStatusHistory)
      .where(eq(orderStatusHistory.orderId, orderId))
      .orderBy(desc(orderStatusHistory.changedAt))
      .limit(10),

    db.select({
      vendor: vendorApiLogs.vendor,
      operation: vendorApiLogs.operation,
      success: vendorApiLogs.success,
      httpStatus: vendorApiLogs.httpStatus,
      createdAt: vendorApiLogs.createdAt,
    })
      .from(vendorApiLogs)
      .where(eq(vendorApiLogs.orderId, orderId))
      .orderBy(desc(vendorApiLogs.createdAt))
      .limit(10),

    db.select({
      searchType: titlePointData.searchType,
      status: titlePointData.status,
      message: titlePointData.message,
      createdAt: titlePointData.createdAt,
    })
      .from(titlePointData)
      .where(eq(titlePointData.orderId, orderId))
      .orderBy(desc(titlePointData.createdAt))
      .limit(5),

    db.select({
      createdAt: adminActivityLogs.createdAt,
      userId: adminActivityLogs.userId,
      meta: adminActivityLogs.meta,
    })
      .from(adminActivityLogs)
      .where(and(
        eq(adminActivityLogs.action, 'prelim_delivered'),
        eq(adminActivityLogs.entityType, 'order'),
        eq(adminActivityLogs.entityId, String(orderId)),
      ))
      .orderBy(desc(adminActivityLogs.createdAt))
      .limit(5),
  ]);

  const items: OrderActivityItem[] = [];

  for (const r of docAuditRows) {
    items.push({
      type: 'document',
      timestamp: r.performedAt,
      summary: `${r.action}: ${r.filename ?? 'unknown'} (${r.category})`,
      meta: { action: r.action, filename: r.filename, category: r.category, byUserId: r.byUserId },
    });
  }

  for (const r of statusRows) {
    items.push({
      type: 'status_change',
      timestamp: r.changedAt,
      summary: `Status → ${r.status} (via ${r.source})`,
      meta: { status: r.status, source: r.source, notes: r.notes },
    });
  }

  for (const r of vendorRows) {
    const label = r.success ? 'success' : `error (${r.httpStatus ?? 'N/A'})`;
    items.push({
      type: 'vendor_call',
      timestamp: r.createdAt,
      summary: `${r.vendor}.${r.operation} — ${label}`,
      meta: { vendor: r.vendor, operation: r.operation, success: r.success, httpStatus: r.httpStatus },
    });
  }

  for (const r of tpRows) {
    items.push({
      type: 'titlepoint',
      timestamp: r.createdAt,
      summary: `TitlePoint ${r.searchType ?? 'search'}: ${r.status ?? 'unknown'}`,
      meta: { searchType: r.searchType, status: r.status, message: r.message },
    });
  }

  for (const r of prelimDeliveryRows) {
    const meta = (r.meta ?? {}) as Record<string, unknown>;
    const recipientCount = typeof meta.recipient_count === 'number' ? meta.recipient_count : 0;
    const deliveredAtPt = typeof meta.delivered_at_pt === 'string' ? meta.delivered_at_pt : r.createdAt.toISOString();
    const sendgridMessageId = typeof meta.sendgrid_message_id === 'string' ? meta.sendgrid_message_id : 'unknown';
    const addNotesStatus = typeof meta.addnotes_status === 'number' ? meta.addnotes_status : null;
    const softproProof = addNotesStatus === 200
      ? `SoftPro note added ${deliveredAtPt} ✓`
      : `SoftPro note pending/failed ${deliveredAtPt}`;

    items.push({
      type: 'prelim_delivery',
      timestamp: r.createdAt,
      summary: `Delivered ${deliveredAtPt} to ${recipientCount} recipients · SendGrid ${sendgridMessageId} AND ${softproProof}`,
      meta: { ...meta, userId: r.userId },
    });
  }

  items.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  staffCache.set(orderId, { data: items, expiresAt: Date.now() + CACHE_TTL_MS });

  return { activity: items.slice(0, limit) };
}
