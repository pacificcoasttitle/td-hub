import { db } from '@/lib/db/client';
import { orders, orderProperties, orderStatusHistory, contacts } from '@/lib/db/schema';
import { eq, or, sql } from 'drizzle-orm';
import { internalOfficerFilter } from '@/lib/domain/contacts/filters';
import { isValidEmail } from '@/lib/domain/notifications/prelim-recipient-resolution';
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
  /**
   * This row is SoftPro's own officer-feed row for a PCT employee, as
   * internalOfficerFilter defines one — a `PCT\user` code and a branch office
   * code on the same row.
   *
   * Required, not optional, so a loader cannot forget to say. `false` is a
   * claim ("this is not an officer-feed row"), not an absence.
   */
  isInternalOfficerRow: boolean;
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

/** Loaders that have no officer-feed row to distinguish still have to say so. */
const NOT_AN_OFFICER_ROW = sql<boolean>`false`;

export async function loadSalesReps(): Promise<ContactRecord[]> {
  return db
    .select({ ...officerColumns, isInternalOfficerRow: NOT_AN_OFFICER_ROW })
    .from(contacts)
    .where(eq(contacts.isSalesRep, true));
}

export async function loadTitleOfficers(): Promise<ContactRecord[]> {
  return db
    .select({ ...officerColumns, isInternalOfficerRow: NOT_AN_OFFICER_ROW })
    .from(contacts)
    .where(eq(contacts.isTitleOfficer, true));
}

/**
 * Candidates for the INBOUND escrow-officer resolver — every contact SoftPro
 * has ever named as an escrow officer, plus the officer-feed row for each PCT
 * employee, flagged so the resolvers can prefer it.
 *
 * Two separate facts are being combined, and the union matters as much as the
 * flag:
 *
 * `is_escrow_officer` is set by reconcileEscrowOfficerFlagsFromOrders from past
 * order assignments, so it marks 725 contacts, most of them outside escrow
 * officers at other firms — Paul Sepulveda, Nestor Reyes, Marjan Rassibi. They
 * have no `PCT\` code and no office code and they are the majority of what
 * arrives. They must stay resolvable: narrowing this query to
 * internalOfficerFilter alone was measured against every officer ever assigned
 * and would have stopped resolving 719 of them across 3,141 orders, writing
 * NULL escrow officers onto inbound orders at nine times the size of the bug
 * being fixed.
 *
 * `internalOfficerFilter` selects the six PCT escrow officers as SoftPro's own
 * officer feed defines them. Four of those six — Ballesteros (12), Gomez (14),
 * Casco (15), Vidaca (16) — have `is_escrow_officer = false`, because every
 * order they were ever assigned resolved to their address-book twin instead, so
 * the reconciler flagged the twin and never them. Without the union arm they
 * are not candidates at all and no ordering could reach them.
 */
export async function loadEscrowOfficers(): Promise<ContactRecord[]> {
  const officerFeedRow = internalOfficerFilter('escrow_officer');
  return db
    .select({ ...officerColumns, isInternalOfficerRow: sql<boolean>`${officerFeedRow}` })
    .from(contacts)
    .where(or(eq(contacts.isEscrowOfficer, true), officerFeedRow));
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

// ─── Choosing between rows that match equally well ───────────────────────────
//
// Anna Ballesteros is two `contacts` rows — 12, the SoftPro officer-feed row
// carrying PRV and `PCT\aballesteros`, and 17165, the address-book row. Both
// answer to the same name, and both carry `PCT\aballesteros` because
// refreshOfficerContact below stamps the feed's lookup code onto whichever row
// resolved. So every tier of every resolver can match both, and something has
// to decide.
//
// That decision is a comparator applied by reduction, deliberately, rather than
// an ORDER BY on the loader or a `limit 1`. A clause is only as stable as the
// next person to edit it: the ambiguous unordered `limit 1` fixed in
// syncEscrowOfficers (PR #55) is exactly the shape being avoided here, and
// reintroducing it one function over would be a poor joke. A reduction over a
// total order cannot be broken by reordering the query, the loop, or the rows:
// every permutation of the same candidate set yields the same answer, which is
// what `resolveEscrowOfficerId is independent of candidate order` pins.

/**
 * The better of two equally-matching rows. Total, antisymmetric, and
 * order-independent.
 *
 * An officer-feed row wins only when it carries a usable email — the same
 * `isValidEmail` test `resolvePrelimRecipients` uses for prelim `to` (and
 * stricter than confirmation CC, which accepts any non-empty trimmed string).
 * Preferring a feed row with no address (Joseph Gomez, contact 14) would take
 * prelim down the `if (escrowOfficerId)` branch, leave `to = null`, and skip
 * the `escrow_company` fallback. Lowest-id alone would still pick 14 over
 * address-book 10999, so an officer-feed row without a usable email ranks last.
 */
function preferenceRank(c: ContactRecord): 0 | 1 | 2 {
  if (c.isInternalOfficerRow && isValidEmail(c.email)) return 0;
  if (c.isInternalOfficerRow) return 2;
  return 1;
}

function preferredOf(a: ContactRecord, b: ContactRecord): ContactRecord {
  const aRank = preferenceRank(a);
  const bRank = preferenceRank(b);
  if (aRank !== bRank) return aRank < bRank ? a : b;
  return a.id <= b.id ? a : b;
}

/** The preferred id among every candidate satisfying `matches`, or null. */
function bestMatchId(
  officers: ContactRecord[],
  matches: (c: ContactRecord) => boolean,
): number | null {
  let best: ContactRecord | null = null;
  for (const o of officers) {
    if (!matches(o)) continue;
    best = best === null ? o : preferredOf(best, o);
  }
  return best?.id ?? null;
}

export function resolveSalesRepId(marketingRep: string | null | undefined, reps: ContactRecord[]): number | null {
  if (!marketingRep || !marketingRep.trim()) return null;
  const target = normalizeName(marketingRep);
  return bestMatchId(reps, (r) => constructedName(r) === target)
    ?? bestMatchId(reps, (r) => normalizeName(r.fullName) === target);
}

export function resolveTitleOfficerId(titleOfficer: string | null | undefined, officers: ContactRecord[]): number | null {
  if (!titleOfficer || !titleOfficer.trim()) return null;
  const target = normalizeName(titleOfficer);
  return bestMatchId(officers, (o) => normalizeName(o.officerName) === target)
    ?? bestMatchId(officers, (o) => constructedName(o) === target);
}

export function resolveOfficerIdByLookupCode(lookupCode: string | null | undefined, officers: ContactRecord[]): number | null {
  if (!lookupCode || !lookupCode.trim()) return null;
  const target = lookupCode.trim().toLowerCase();
  return bestMatchId(officers, (o) => o.softproLookupCode?.trim().toLowerCase() === target)
    ?? bestMatchId(officers, (o) => o.sourceId?.trim().toLowerCase() === target);
}

export function resolveEscrowOfficerId(escrowOfficer: string | null | undefined, officers: ContactRecord[]): number | null {
  if (!escrowOfficer || !escrowOfficer.trim()) return null;
  const target = normalizeName(escrowOfficer);
  return bestMatchId(officers, (o) => normalizeName(o.officerName) === target)
    ?? bestMatchId(officers, (o) => normalizeName(o.fullName) === target)
    ?? bestMatchId(officers, (o) => constructedName(o) === target);
}

// ─── Price parsing ───────────────────────────────────────────────────────────

/**
 * SoftPro is not consistent about money types: SalesPrice arrives as a string
 * ("0", "430000.00") and LoanAmount as a number (950000). Accepting both is
 * not defensiveness — passing the number to the old string-only version threw
 * on `.trim()`.
 */
export function parseMoney(raw: string | number | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw.toFixed(2) : null;
  if (!raw.trim()) return null;
  const num = parseFloat(raw.replace(/[$,\s]/g, ''));
  return Number.isNaN(num) ? null : num.toFixed(2);
}

/** @deprecated Use parseMoney — kept because other callers pass strings. */
export function parseSalesPrice(raw: string | null | undefined): string | null {
  return parseMoney(raw);
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
  /**
   * `order_status_history.source` for rows written by this call.
   *
   * The look-back sync passes 'lookback_sync' so a bulk correction is
   * distinguishable from ordinary sync activity — the dashboard activity feed
   * excludes it, otherwise one backfill would bury days of real events.
   * Defaults to the import/webhook value.
   */
  statusHistorySource?: 'softpro_sync' | 'manual' | 'system' | 'webhook' | 'lookback_sync';
}

export async function processOrderDetail(
  item: SoftProOrderDetailItem,
  options: ProcessOrderDetailOptions = {},
): Promise<void> {
  const fileNumber = item.OrderNumber;
  if (!fileNumber) return;

  const preserveExistingOnEmpty = options.preserveExistingOnEmpty === true;
  const emptyField = preserveExistingOnEmpty ? undefined : null;
  const statusHistorySource = options.statusHistorySource ?? 'softpro_sync';

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
  // LoanAmount was detected by the lookback sweep but never written, because
  // nothing mapped it here. Confirmed present on the wire 2026-08-28.
  const loanAmount = parseMoney(item.LoanAmount);
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
      // undefined omits the column, so a response without LoanAmount leaves
      // whatever is already there rather than erasing it.
      loanAmount: loanAmount ?? undefined,
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
        source: statusHistorySource,
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
      // Null when SoftPro returned no ReceivedDate. Not now() — see the column.
      openedAt,
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
      zip: item.Zip?.trim() || null,
      county: item.Country || null,
    });

    await db.insert(orderStatusHistory).values({
      orderId: newOrder!.id,
      status: operationalStatus,
      source: statusHistorySource,
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
  const address = item.Address?.trim() || null;
  const city = item.City?.trim() || null;
  const state = item.State?.trim() || null;
  const zip = item.Zip?.trim() || null;
  const county = item.Country?.trim() || null;

  // SoftPro ProductType is order-level (orders.product_type) — never map to property_type.
  if (!address && !city && !state && !zip && !county) return;

  const [existing] = await db
    .select({ id: orderProperties.id })
    .from(orderProperties)
    .where(eq(orderProperties.orderId, orderId))
    .limit(1);

  if (existing) {
    // Preserve-on-empty: only write non-empty SoftPro values (never blank existing).
    await db.update(orderProperties).set({
      ...(address ? { address } : {}),
      ...(city ? { city } : {}),
      ...(state ? { state } : {}),
      ...(zip ? { zip } : {}),
      ...(county ? { county } : {}),
      updatedAt: new Date(),
    }).where(eq(orderProperties.id, existing.id));
  } else {
    await db.insert(orderProperties).values({
      orderId,
      address,
      city,
      state,
      zip,
      county,
    });
  }
}
