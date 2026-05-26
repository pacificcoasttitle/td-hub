import { db } from '@/lib/db/client';
import { orders, orderProperties, orderStatusHistory, contacts } from '@/lib/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { parseSoftProDate } from '@/lib/integrations/softpro/types';
import type { SoftProOrderDetailItem } from '@/lib/integrations/softpro/types';

// ─── Shared types ────────────────────────────────────────────────────────────

export type OperationalStatus = 'open' | 'in_process' | 'completed' | 'closed' | 'canceled' | 'duplicate';
export type TransactionType = 'Purchase' | 'Refinance' | 'Equity' | 'Other';

export interface ContactRecord {
  id: number;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  officerName: string | null;
}

// ─── Status / type mapping ───────────────────────────────────────────────────

export function mapStatus(raw: string): OperationalStatus {
  const s = raw.toLowerCase().trim();
  switch (s) {
    case 'open': return 'open';
    case 'in process':
    case 'inprocess':
    case 'in_process': return 'in_process';
    case 'completed':
    case 'clear for policy': return 'completed';
    case 'closed': return 'closed';
    case 'canceled':
    case 'cancelled': return 'canceled';
    case 'duplicate': return 'duplicate';
    default: return 'open';
  }
}

export function mapTransactionType(raw: string | null | undefined): TransactionType | null {
  if (!raw || !raw.trim()) return null;
  const normalized = raw.trim().toLowerCase();
  switch (normalized) {
    case 'purchase': return 'Purchase';
    case 'refinance':
    case 'refi': return 'Refinance';
    case 'equity':
    case 'home equity': return 'Equity';
    case 'other': return 'Other';
    default: return 'Other';
  }
}

// ─── Officer loaders ─────────────────────────────────────────────────────────

const officerColumns = {
  id: contacts.id,
  firstName: contacts.firstName,
  lastName: contacts.lastName,
  fullName: contacts.fullName,
  officerName: contacts.officerName,
};

export async function loadSalesReps(): Promise<ContactRecord[]> {
  return db.select(officerColumns).from(contacts).where(eq(contacts.isSalesRep, true));
}

export async function loadTitleOfficers(): Promise<ContactRecord[]> {
  return db.select(officerColumns).from(contacts).where(eq(contacts.isTitleOfficer, true));
}

export async function loadEscrowOfficers(): Promise<ContactRecord[]> {
  // Exclude PCT\ login-code rows so the resolver always lands on the
  // canonical person-code contact, preventing duplicate-row regressions.
  return db
    .select(officerColumns)
    .from(contacts)
    .where(and(
      eq(contacts.isEscrowOfficer, true),
      sql`(${contacts.sourceId} IS NULL OR ${contacts.sourceId} NOT LIKE 'PCT\\%')`,
    ));
}

// ─── Resolvers ───────────────────────────────────────────────────────────────

function normalizeName(name: string | null | undefined): string {
  if (!name) return '';
  return name.trim().toLowerCase();
}

function constructedName(c: ContactRecord): string {
  const parts = [c.firstName, c.lastName].filter(Boolean);
  return parts.join(' ').trim().toLowerCase();
}

export function resolveSalesRepId(marketingRep: string | null | undefined, reps: ContactRecord[]): number | null {
  if (!marketingRep || !marketingRep.trim()) return null;
  const target = normalizeName(marketingRep);
  for (const rep of reps) if (constructedName(rep) === target) return rep.id;
  for (const rep of reps) if (normalizeName(rep.fullName) === target) return rep.id;
  return null;
}

export function resolveTitleOfficerId(titleOfficer: string | null | undefined, officers: ContactRecord[]): number | null {
  if (!titleOfficer || !titleOfficer.trim()) return null;
  const target = normalizeName(titleOfficer);
  for (const o of officers) if (normalizeName(o.officerName) === target) return o.id;
  for (const o of officers) if (constructedName(o) === target) return o.id;
  return null;
}

export function resolveEscrowOfficerId(escrowOfficer: string | null | undefined, officers: ContactRecord[]): number | null {
  if (!escrowOfficer || !escrowOfficer.trim()) return null;
  const target = normalizeName(escrowOfficer);
  for (const o of officers) if (normalizeName(o.officerName) === target) return o.id;
  for (const o of officers) if (normalizeName(o.fullName) === target) return o.id;
  for (const o of officers) if (constructedName(o) === target) return o.id;
  return null;
}

// ─── Price parsing ───────────────────────────────────────────────────────────

export function parseSalesPrice(raw: string | null | undefined): string | null {
  if (!raw || !raw.trim()) return null;
  const cleaned = raw.replace(/[$,\s]/g, '');
  const num = parseFloat(cleaned);
  if (isNaN(num)) return null;
  return num.toFixed(2);
}

// ─── Single-order processor ──────────────────────────────────────────────────
//
// Upserts the order row + properties + status history from one
// GetOrderDetails item. Used by both the date-range import-orders flow
// and the per-order enrich-order-details flow.

export interface ProcessOrderDetailOptions {
  /**
   * Pre-loaded officer caches. If omitted, the caches are loaded once on
   * demand and reused inside this call.
   */
  salesReps?: ContactRecord[];
  titleOfficers?: ContactRecord[];
  escrowOfficers?: ContactRecord[];
}

export async function processOrderDetail(
  item: SoftProOrderDetailItem,
  options: ProcessOrderDetailOptions = {},
): Promise<void> {
  const fileNumber = item.OrderNumber;
  if (!fileNumber) return;

  const salesReps = options.salesReps ?? await loadSalesReps();
  const titleOfficers = options.titleOfficers ?? await loadTitleOfficers();
  const escrowOfficers = options.escrowOfficers ?? await loadEscrowOfficers();

  const operationalStatus = mapStatus(item.OrderStatus ?? 'open');
  const softproStatus = (item.OrderStatus ?? 'open').toLowerCase().trim();
  const transactionType = mapTransactionType(item.TransactionType);
  const salesPrice = parseSalesPrice(item.SalesPrice);
  const openedAt = parseSoftProDate(item.ReceivedDate);
  const completedAt = parseSoftProDate(item.CompletedDate);
  const closedAt = operationalStatus === 'closed' ? parseSoftProDate(item.ModifiedDate) : null;

  const salesRepId = resolveSalesRepId(item.MarketingRep, salesReps);
  const titleOfficerId = resolveTitleOfficerId(item.TitleOfficer, titleOfficers);
  const escrowOfficerId = resolveEscrowOfficerId(item.EscrowOfficer, escrowOfficers);

  if (item.EscrowOfficer?.trim() && escrowOfficerId === null) {
    console.warn('[process-order-detail] Unable to resolve SoftPro escrow officer', {
      fileNumber,
      escrowOfficer: item.EscrowOfficer,
    });
  }

  const [existing] = await db
    .select({ id: orders.id, operationalStatus: orders.operationalStatus })
    .from(orders)
    .where(eq(orders.fileNumber, fileNumber))
    .limit(1);

  if (existing) {
    const statusChanged = existing.operationalStatus !== operationalStatus;

    await db.update(orders).set({
      softproStatus,
      operationalStatus,
      transactionType,
      productType: item.ProductType || null,
      orderType: item.OrderType || null,
      salesPrice: salesPrice ?? undefined,
      marketingSource: item.MarketingSource || null,
      salesRepId: salesRepId ?? undefined,
      titleOfficerId: titleOfficerId ?? undefined,
      escrowOfficerId: escrowOfficerId ?? undefined,
      openedAt: openedAt ?? undefined,
      completedAt: completedAt ?? undefined,
      closedAt: closedAt ?? undefined,
      softproLastSyncedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(orders.id, existing.id));

    await upsertOrderProperty(existing.id, item);

    if (statusChanged) {
      await db.insert(orderStatusHistory).values({
        orderId: existing.id,
        status: operationalStatus,
        source: 'softpro_sync',
        notes: `Import: status changed from ${existing.operationalStatus} to ${operationalStatus}`,
      });
    }
  } else {
    const [newOrder] = await db.insert(orders).values({
      fileNumber,
      operationalStatus,
      softproStatus,
      transactionType,
      productType: item.ProductType || null,
      orderType: item.OrderType || null,
      salesPrice,
      marketingSource: item.MarketingSource || null,
      salesRepId,
      titleOfficerId,
      escrowOfficerId,
      openedAt: openedAt ?? new Date(),
      completedAt,
      closedAt,
      source: 'softpro_sync',
      isImported: true,
      softproLastSyncedAt: new Date(),
    }).returning({ id: orders.id });

    await db.insert(orderProperties).values({
      orderId: newOrder!.id,
      address: item.Address || null,
      city: item.City || null,
      state: item.State || null,
      county: item.Country || null,
    });

    await db.insert(orderStatusHistory).values({
      orderId: newOrder!.id,
      status: operationalStatus,
      source: 'softpro_sync',
      notes: 'Imported via GetOrderDetails',
    });
  }
}

async function upsertOrderProperty(
  orderId: number,
  item: SoftProOrderDetailItem,
): Promise<void> {
  const address = item.Address || null;
  const city = item.City || null;
  const state = item.State || null;
  const county = item.Country || null;

  if (!address && !city && !state && !county) return;

  const [existing] = await db
    .select({ id: orderProperties.id })
    .from(orderProperties)
    .where(eq(orderProperties.orderId, orderId))
    .limit(1);

  if (existing) {
    await db.update(orderProperties).set({
      ...(address ? { address } : {}),
      ...(city ? { city } : {}),
      ...(state ? { state } : {}),
      ...(county ? { county } : {}),
      updatedAt: new Date(),
    }).where(eq(orderProperties.id, existing.id));
  } else {
    await db.insert(orderProperties).values({
      orderId,
      address,
      city,
      state,
      county,
    });
  }
}
