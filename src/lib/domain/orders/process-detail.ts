import { db } from '@/lib/db/client';
import { orders, orderProperties, orderStatusHistory, contacts } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { parseSoftProDate } from '@/lib/integrations/softpro/types';
import type { SoftProOrderDetailItem, SoftProResolvedPerson } from '@/lib/integrations/softpro/types';
import {
  mapStatus,
  mapTransactionType,
  type OperationalStatus,
  type TransactionType,
} from './status-map';

export type { OperationalStatus, TransactionType };
export { mapStatus, mapTransactionType };

// ─── Shared types ────────────────────────────────────────────────────────────

export interface ContactRecord {
  id: number;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  officerName: string | null;
  softproLookupCode: string | null;
  sourceId: string | null;
  email: string | null;
  phone: string | null;
}

// ─── Officer loaders ─────────────────────────────────────────────────────────

const officerColumns = {
  id: contacts.id,
  firstName: contacts.firstName,
  lastName: contacts.lastName,
  fullName: contacts.fullName,
  officerName: contacts.officerName,
  softproLookupCode: contacts.softproLookupCode,
  sourceId: contacts.sourceId,
  email: contacts.email,
  phone: contacts.phone,
};

export async function loadSalesReps(): Promise<ContactRecord[]> {
  return db.select(officerColumns).from(contacts).where(eq(contacts.isSalesRep, true));
}

export async function loadTitleOfficers(): Promise<ContactRecord[]> {
  return db.select(officerColumns).from(contacts).where(eq(contacts.isTitleOfficer, true));
}

export async function loadEscrowOfficers(): Promise<ContactRecord[]> {
  return db.select(officerColumns).from(contacts).where(eq(contacts.isEscrowOfficer, true));
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

function resolveOfficerIdByLookupCode(lookupCode: string | null | undefined, officers: ContactRecord[]): number | null {
  if (!lookupCode || !lookupCode.trim()) return null;
  const target = lookupCode.trim().toLowerCase();
  for (const o of officers) if (o.softproLookupCode?.trim().toLowerCase() === target) return o.id;
  for (const o of officers) if (o.sourceId?.trim().toLowerCase() === target) return o.id;
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
  /**
   * When true (resync), empty SoftPro string fields omit the column on
   * existing-order updates so prior values are preserved. Default false
   * keeps import/webhook behavior: empty → null.
   */
  preserveExistingOnEmpty?: boolean;
}

export async function processOrderDetail(
  item: SoftProOrderDetailItem,
  options: ProcessOrderDetailOptions = {},
): Promise<void> {
  const fileNumber = item.OrderNumber;
  if (!fileNumber) return;

  const preserveExistingOnEmpty = options.preserveExistingOnEmpty === true;
  const emptyField = preserveExistingOnEmpty ? undefined : null;

  const salesReps = options.salesReps ?? await loadSalesReps();
  const titleOfficers = options.titleOfficers ?? await loadTitleOfficers();
  const escrowOfficers = options.escrowOfficers ?? await loadEscrowOfficers();

  const orderStatusPresent = Boolean(item.OrderStatus?.trim());
  const mappedStatus = mapStatus(item.OrderStatus);
  const softproStatus = orderStatusPresent
    ? item.OrderStatus!.toLowerCase().trim()
    : null;
  const transactionType = mapTransactionType(item.TransactionType);
  const salesPrice = parseSalesPrice(item.SalesPrice);
  const openedAt = parseSoftProDate(item.ReceivedDate);
  const completedAt = parseSoftProDate(item.CompletedDate);
  const closedAt = mappedStatus === 'closed' ? parseSoftProDate(item.ModifiedDate) : null;
  const titleOfficerName = item.TitleOfficerContact?.Name?.trim() || item.TitleOfficer;
  const escrowOfficerName = item.EscrowOfficerContact?.Name?.trim() || item.EscrowOfficer;

  const salesRepId = resolveSalesRepId(item.MarketingRep, salesReps);
  const titleOfficerId = resolveOfficerIdByLookupCode(item.TitleOfficerContact?.LookupCode, titleOfficers)
    ?? resolveTitleOfficerId(titleOfficerName, titleOfficers);
  const escrowOfficerId = resolveOfficerIdByLookupCode(item.EscrowOfficerContact?.LookupCode, escrowOfficers)
    ?? resolveEscrowOfficerId(escrowOfficerName, escrowOfficers);

  if (escrowOfficerName?.trim() && escrowOfficerId === null) {
    console.warn('[process-order-detail] Unable to resolve SoftPro escrow officer', {
      fileNumber,
      escrowOfficer: escrowOfficerName,
      escrowOfficerLookupCode: item.EscrowOfficerContact?.LookupCode,
    });
  }

  const [existing] = await db
    .select({ id: orders.id, operationalStatus: orders.operationalStatus })
    .from(orders)
    .where(eq(orders.fileNumber, fileNumber))
    .limit(1);

  if (existing) {
    // Never guess operational_status: only write when SoftPro maps to a known value.
    // Unknown/blank OrderStatus preserves the existing operational_status.
    const shouldUpdateSoftproStatus = orderStatusPresent
      || (!preserveExistingOnEmpty && !orderStatusPresent);
    const shouldUpdateOperationalStatus = mappedStatus != null;
    const statusChanged =
      shouldUpdateOperationalStatus && existing.operationalStatus !== mappedStatus;

    await db.update(orders).set({
      ...(shouldUpdateSoftproStatus
        ? { softproStatus: softproStatus ?? (preserveExistingOnEmpty ? undefined : null) }
        : {}),
      ...(shouldUpdateOperationalStatus ? { operationalStatus: mappedStatus } : {}),
      // Drizzle mapUpdateSet filters undefined → column omitted (preserves existing).
      transactionType: transactionType ?? emptyField,
      productType: item.ProductType || emptyField,
      orderType: item.OrderType || emptyField,
      salesPrice: salesPrice ?? undefined,
      marketingSource: item.MarketingSource || emptyField,
      salesRepId: salesRepId ?? undefined,
      titleOfficerId: titleOfficerId ?? undefined,
      escrowOfficerId: escrowOfficerId ?? undefined,
      openedAt: openedAt ?? undefined,
      completedAt: completedAt ?? undefined,
      closedAt: closedAt ?? undefined,
      softproLastSyncedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(orders.id, existing.id));

    await refreshOfficerContact(titleOfficerId, item.TitleOfficerContact);
    await refreshOfficerContact(escrowOfficerId, item.EscrowOfficerContact);
    await upsertOrderProperty(existing.id, item);

    if (statusChanged && mappedStatus) {
      await db.insert(orderStatusHistory).values({
        orderId: existing.id,
        status: mappedStatus,
        source: 'softpro_sync',
        notes: `Import: status changed from ${existing.operationalStatus} to ${mappedStatus}`,
      });
    }
  } else {
    const operationalStatus = mappedStatus ?? 'open';
    const [newOrder] = await db.insert(orders).values({
      fileNumber,
      operationalStatus,
      softproStatus: softproStatus ?? 'open',
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

    await refreshOfficerContact(titleOfficerId, item.TitleOfficerContact);
    await refreshOfficerContact(escrowOfficerId, item.EscrowOfficerContact);
  }
}

async function refreshOfficerContact(contactId: number | null, resolved: SoftProResolvedPerson | null | undefined): Promise<void> {
  if (!contactId || !resolved) return;

  const update: Partial<typeof contacts.$inferInsert> = { updatedAt: new Date() };
  const name = resolved.Name?.trim();
  const lookupCode = resolved.LookupCode?.trim();
  const email = resolved.Email?.trim();
  const phone = resolved.Phone?.trim();

  if (name) {
    update.fullName = name;
    update.officerName = name;
  }
  if (lookupCode) {
    update.softproLookupCode = lookupCode;
    update.sourceId = lookupCode;
  }
  if (email) update.email = email;
  if (phone) update.phone = phone;

  if (Object.keys(update).length === 1) return;
  await db.update(contacts).set(update).where(eq(contacts.id, contactId));
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
