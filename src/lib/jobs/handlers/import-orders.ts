import { db } from '@/lib/db/client';
import { orders, orderProperties, orderStatusHistory, contacts } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { getOrderDetails } from '@/lib/integrations/softpro';
import { parseSoftProDate } from '@/lib/integrations/softpro/types';
import type { SoftProOrderDetailItem } from '@/lib/integrations/softpro/types';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ImportOrdersPayload {
  dateFrom: string;
  dateTo: string;
}

export interface ImportOrdersResult {
  total: number;
  imported: number;
  updated: number;
  errors: Array<{ fileNumber: string; error: string }>;
}

type OperationalStatus = 'open' | 'in_process' | 'completed' | 'closed' | 'canceled' | 'duplicate';
type TransactionType = 'Purchase' | 'Refinance' | 'Equity' | 'Other';

// ─── Status Mapping ──────────────────────────────────────────────────────────

function mapStatus(raw: string): OperationalStatus {
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

// ─── Transaction Type Mapping ────────────────────────────────────────────────

function mapTransactionType(raw: string | null | undefined): TransactionType | null {
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

// ─── Officer Resolution ──────────────────────────────────────────────────────

interface ContactRecord {
  id: number;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  officerName: string | null;
}

let _salesReps: ContactRecord[] | null = null;
let _titleOfficers: ContactRecord[] | null = null;

async function loadSalesReps(): Promise<ContactRecord[]> {
  if (_salesReps) return _salesReps;
  _salesReps = await db
    .select({
      id: contacts.id,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      fullName: contacts.fullName,
      officerName: contacts.officerName,
    })
    .from(contacts)
    .where(eq(contacts.isSalesRep, true));
  return _salesReps;
}

async function loadTitleOfficers(): Promise<ContactRecord[]> {
  if (_titleOfficers) return _titleOfficers;
  _titleOfficers = await db
    .select({
      id: contacts.id,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      fullName: contacts.fullName,
      officerName: contacts.officerName,
    })
    .from(contacts)
    .where(eq(contacts.isTitleOfficer, true));
  return _titleOfficers;
}

function normalizeName(name: string | null | undefined): string {
  if (!name) return '';
  return name.trim().toLowerCase();
}

function constructedName(c: ContactRecord): string {
  const parts = [c.firstName, c.lastName].filter(Boolean);
  return parts.join(' ').trim().toLowerCase();
}

function resolveSalesRepId(marketingRep: string | null | undefined, reps: ContactRecord[]): number | null {
  if (!marketingRep || !marketingRep.trim()) return null;
  const target = normalizeName(marketingRep);

  for (const rep of reps) {
    if (constructedName(rep) === target) return rep.id;
  }
  for (const rep of reps) {
    if (normalizeName(rep.fullName) === target) return rep.id;
  }
  return null;
}

function resolveTitleOfficerId(titleOfficer: string | null | undefined, officers: ContactRecord[]): number | null {
  if (!titleOfficer || !titleOfficer.trim()) return null;
  const target = normalizeName(titleOfficer);

  for (const o of officers) {
    if (normalizeName(o.officerName) === target) return o.id;
  }
  for (const o of officers) {
    if (constructedName(o) === target) return o.id;
  }
  return null;
}

// ─── Price Parsing ───────────────────────────────────────────────────────────

function parseSalesPrice(raw: string | null | undefined): string | null {
  if (!raw || !raw.trim()) return null;
  const cleaned = raw.replace(/[$,\s]/g, '');
  const num = parseFloat(cleaned);
  if (isNaN(num)) return null;
  return num.toFixed(2);
}

// ─── Main Handler ────────────────────────────────────────────────────────────

export async function importOrdersFromSoftPro(
  payload: ImportOrdersPayload
): Promise<ImportOrdersResult> {
  _salesReps = null;
  _titleOfficers = null;

  const apiResult = await getOrderDetails({
    dateFrom: payload.dateFrom,
    dateTo: payload.dateTo,
  });

  if (!apiResult.success || !apiResult.data) {
    return {
      total: 0,
      imported: 0,
      updated: 0,
      errors: [{
        fileNumber: '*',
        error: apiResult.error?.message ?? 'GetOrderDetails failed or returned no data',
      }],
    };
  }

  const items = apiResult.data;
  if (items.length === 0) {
    return { total: 0, imported: 0, updated: 0, errors: [] };
  }

  const salesReps = await loadSalesReps();
  const titleOfficers = await loadTitleOfficers();

  let imported = 0;
  let updated = 0;
  const errors: ImportOrdersResult['errors'] = [];

  for (const item of items) {
    try {
      await processOrderDetail(item, salesReps, titleOfficers);

      const existing = await db.select({ id: orders.id })
        .from(orders)
        .where(eq(orders.fileNumber, item.OrderNumber))
        .limit(1);

      if (existing.length > 0) {
        updated++;
      } else {
        imported++;
      }
    } catch (err) {
      errors.push({
        fileNumber: item.OrderNumber ?? 'unknown',
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  return { total: items.length, imported, updated, errors };
}

// ─── Process Single Order Detail ─────────────────────────────────────────────

async function processOrderDetail(
  item: SoftProOrderDetailItem,
  salesReps: ContactRecord[],
  titleOfficers: ContactRecord[],
): Promise<void> {
  const fileNumber = item.OrderNumber;
  if (!fileNumber) return;

  const operationalStatus = mapStatus(item.OrderStatus ?? 'open');
  const softproStatus = (item.OrderStatus ?? 'open').toLowerCase().trim();
  const transactionType = mapTransactionType(item.TransactionType);
  const salesPrice = parseSalesPrice(item.SalesPrice);
  const openedAt = parseSoftProDate(item.ReceivedDate);
  const completedAt = parseSoftProDate(item.CompletedDate);
  const closedAt = operationalStatus === 'closed' ? parseSoftProDate(item.ModifiedDate) : null;

  const salesRepId = resolveSalesRepId(item.MarketingRep, salesReps);
  const titleOfficerId = resolveTitleOfficerId(item.TitleOfficer, titleOfficers);

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

// ─── Upsert Order Property ──────────────────────────────────────────────────

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
