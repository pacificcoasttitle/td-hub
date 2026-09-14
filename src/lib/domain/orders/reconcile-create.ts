/**
 * Finish a hub create that SoftPro accepted and our own write did not.
 *
 * ─── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * A hub create writes SoftPro first, then the local order, property, parties
 * and status. When a local insert throws after SoftPro's 200, the file exists in
 * SoftPro and the hub holds an order with no address, no title search and no
 * documents. The operator is told not to re-enter — correctly, because re-entry
 * mints a second SoftPro file (20022160-GLT and 20022161-GLT are one Fontana
 * property) — and until now "contact support" meant a message to Gerard, and
 * the fix was an insert typed by hand from data we already held.
 *
 * Everything needed is logged: the SoftPro create payload carries address,
 * city, state, zip, county, APN and legal description. This does, for one order
 * at a button press, what scripts/audit/repair-create-order-orphans.ts did for a
 * list, through the same builders.
 *
 * ─── WHAT IT DOES AND DOES NOT DO ───────────────────────────────────────────
 *
 * Does: insert the missing property row from the logged payload, write the
 * status-history row the create never reached, start TitlePoint when it has
 * not started and the county is known (what the create would have done), and
 * record who pressed it.
 *
 * Does not: write SoftPro, cancel anything, re-send a confirmation, or invent a
 * field the payload does not carry. Parties are not written here — the SoftPro
 * enrich reads them back from the file the operator's entry created.
 *
 * Only offered for an order with a recorded `order_create_local_failed` and no
 * property row. An order the SoftPro sync imported first (cause B,
 * CREATE_RACES_ITS_OWN_SYNC.md) already has its property and is not this.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  adminActivityLogs, orderProperties, orderStatusHistory, orders, titlePointData, vendorApiLogs,
} from '@/lib/db/schema';
import {
  attachMissingOrderProperty,
  propertyFromSoftProCreatePayload,
  type SoftProCreatePropertyDetails,
} from './create-order';
import { autoTriggerTitlePoint } from '@/lib/domain/titlepoint/auto-trigger';
import { explainCreateFailure, type RecordedCreateFailure } from './create-failure';

export const CREATE_FAILED_ACTION = 'order_create_local_failed';
export const CREATE_RECONCILED_ACTION = 'order_create_reconciled';

export type ReconcileState =
  | {
      needed: true;
      fileNumber: string;
      failedAt: string;
      /** Plain-language reason from the recorded Postgres error. */
      reason: string;
      /** The logged SoftPro payload is what the property is rebuilt from. */
      payloadAvailable: boolean;
    }
  | { needed: false; reason: 'not_found' | 'canceled' | 'duplicate' | 'no_failure_recorded' | 'property_present' };

export type ReconcileResult =
  | {
      ok: true;
      fileNumber: string;
      property: 'inserted' | 'already_present';
      statusHistory: 'inserted' | 'already_present';
      titlePoint: 'started' | 'already_started' | 'no_county' | 'not_started';
    }
  | { ok: false; code: 'NOT_NEEDED' | 'MISSING_PAYLOAD'; error: string };

async function loadOrder(orderId: number) {
  const [order] = await db
    .select({ id: orders.id, fileNumber: orders.fileNumber, operationalStatus: orders.operationalStatus })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  return order ?? null;
}

async function latestFailure(fileNumber: string): Promise<{ createdAt: Date; meta: RecordedCreateFailure } | null> {
  const [row] = await db
    .select({ createdAt: adminActivityLogs.createdAt, meta: adminActivityLogs.meta })
    .from(adminActivityLogs)
    .where(and(eq(adminActivityLogs.action, CREATE_FAILED_ACTION), eq(adminActivityLogs.entityId, fileNumber)))
    .orderBy(desc(adminActivityLogs.createdAt))
    .limit(1);
  return row ? { createdAt: row.createdAt, meta: (row.meta ?? {}) as RecordedCreateFailure } : null;
}

async function hasProperty(orderId: number): Promise<boolean> {
  const rows = await db
    .select({ id: orderProperties.id })
    .from(orderProperties)
    .where(eq(orderProperties.orderId, orderId))
    .limit(1);
  return rows.length > 0;
}

/** The SoftPro create payload we sent for this file, as logged. */
export async function loadLoggedCreatePayload(fileNumber: string): Promise<SoftProCreatePropertyDetails | null> {
  const [row] = await db
    .select({
      propertyDetails: sql<SoftProCreatePropertyDetails | null>`${vendorApiLogs.requestMeta}->'payload'->'propertyDetails'`,
    })
    .from(vendorApiLogs)
    .where(and(
      eq(vendorApiLogs.vendor, 'softpro'),
      eq(vendorApiLogs.operation, 'create_order'),
      sql`${vendorApiLogs.responseMeta}->>'orderNumber' = ${fileNumber}`,
    ))
    .orderBy(vendorApiLogs.startedAt)
    .limit(1);
  return row?.propertyDetails ?? null;
}

export async function getReconcileState(orderId: number): Promise<ReconcileState> {
  const order = await loadOrder(orderId);
  if (!order) return { needed: false, reason: 'not_found' };
  // Not for a file someone is closing out. 20022160-GLT — one of the two Fontana
  // files for a single property — was marked duplicate the day this shipped;
  // finishing it would start a title search on the file being cancelled.
  if (order.operationalStatus === 'canceled') return { needed: false, reason: 'canceled' };
  if (order.operationalStatus === 'duplicate') return { needed: false, reason: 'duplicate' };
  const failure = await latestFailure(order.fileNumber);
  if (!failure) return { needed: false, reason: 'no_failure_recorded' };
  if (await hasProperty(order.id)) return { needed: false, reason: 'property_present' };
  return {
    needed: true,
    fileNumber: order.fileNumber,
    failedAt: failure.createdAt.toISOString(),
    reason: explainCreateFailure(failure.meta),
    payloadAvailable: (await loadLoggedCreatePayload(order.fileNumber)) !== null,
  };
}

export async function reconcileFailedCreate(orderId: number, actorUserId: string): Promise<ReconcileResult> {
  const state = await getReconcileState(orderId);
  if (!state.needed) {
    return { ok: false, code: 'NOT_NEEDED', error: notNeededMessage(state.reason) };
  }

  const payload = await loadLoggedCreatePayload(state.fileNumber);
  if (!payload) {
    return {
      ok: false,
      code: 'MISSING_PAYLOAD',
      error: `No SoftPro create payload is logged for ${state.fileNumber}, so there is nothing to rebuild the address from. This one needs a person.`,
    };
  }

  // Throws on a payload without address, city or zip — deliberately. A property
  // row built from a guess is worse than none: it starts a title search.
  const mapped = propertyFromSoftProCreatePayload(payload);
  const property = await attachMissingOrderProperty(orderId, { property: mapped.property }, null, mapped.enriched);

  const [history] = await db
    .select({ id: orderStatusHistory.id })
    .from(orderStatusHistory)
    .where(eq(orderStatusHistory.orderId, orderId))
    .limit(1);
  let statusHistory: 'inserted' | 'already_present' = 'already_present';
  if (!history) {
    await db.insert(orderStatusHistory).values({
      orderId,
      status: 'open',
      source: 'manual',
      notes: `Order created and sent to SoftPro (${state.fileNumber}); finished by reconcile after the hub write failed`,
    });
    statusHistory = 'inserted';
  }

  const [tp] = await db
    .select({ id: titlePointData.id })
    .from(titlePointData)
    .where(eq(titlePointData.orderId, orderId))
    .limit(1);
  let titlePoint: 'started' | 'already_started' | 'no_county' | 'not_started' = 'already_started';
  if (!tp) {
    if (!mapped.enriched.county) {
      titlePoint = 'no_county';
    } else {
      const started = await autoTriggerTitlePoint(orderId, {
        address: mapped.property.address,
        city: mapped.property.city,
        state: mapped.property.state,
        county: mapped.enriched.county,
        apn: mapped.enriched.apn || null,
        fips: mapped.enriched.fips,
      });
      titlePoint = started.initiated > 0 ? 'started' : 'not_started';
    }
  }

  const result = { ok: true as const, fileNumber: state.fileNumber, property, statusHistory, titlePoint };
  try {
    await db.insert(adminActivityLogs).values({
      userId: actorUserId,
      action: CREATE_RECONCILED_ACTION,
      entityType: 'order',
      entityId: state.fileNumber,
      meta: { orderId, property, statusHistory, titlePoint, failedAt: state.failedAt, reason: state.reason },
    });
  } catch {
    // The repair happened; a missing audit row must not report it as failed.
  }
  return result;
}

function notNeededMessage(reason: Exclude<ReconcileState, { needed: true }>['reason']): string {
  switch (reason) {
    case 'not_found': return 'Order not found.';
    case 'canceled': return 'This order is canceled — it is not reconciled.';
    case 'duplicate': return 'This order is marked duplicate — finish the file that is being kept, not this one.';
    case 'no_failure_recorded': return 'No failed hub create is recorded for this order, so there is nothing to finish.';
    case 'property_present': return 'This order already has its property — there is nothing to finish.';
  }
}
