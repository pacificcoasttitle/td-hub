import { db } from '@/lib/db/client';
import { jobs, orders, orderParties, contacts } from '@/lib/db/schema';
import { eq, sql } from 'drizzle-orm';
import { getOrderContacts, getOrderDetails, mapOrderContacts } from '@/lib/integrations/softpro';
import type { MappedOrderContacts } from '@/lib/integrations/softpro';
import { mapStatus } from '@/lib/domain/orders/status-map';
import { createDeadline } from '@/lib/jobs/time-budget';
import type { DriftCounts } from '@/lib/domain/ops/status-drift';

type ExistingParty = typeof orderParties.$inferSelect;

// ─── Status drift detector ──────────────────────────────────────────────────
//
// This job used to filter `where operational_status = 'open'` — a status only 2
// of 6,612 rows have ever held — so it examined 2 orders daily and reported
// success. That false green is why ~24% order-status drift accumulated
// unnoticed (docs/order-status-hygiene.md).
//
// It now samples the `in_process` population, asks SoftPro for each order's
// CURRENT status, and reports how many have already moved on.
//
// READ-ONLY BY DESIGN. It writes no order status and performs no reconciliation.
// Correcting the data is the look-back sync's job; conflating "detect" with
// "fix" is what makes a broken detector invisible. The only write is this job
// recording its own counts on its own `jobs` row so the panel can trend them.

/**
 * Orders sampled per run. Comfortably above MIN_CHECKED_FOR_ALERT (20) even if
 * a quarter of the calls time out, and at ~2-4s per call it lands inside the
 * 254s budget with room to spare.
 */
export const DRIFT_SAMPLE_SIZE = 40;

/**
 * Per-call ceiling. `getOrderDetails` hardcodes 120s, far too long here — one
 * hung request would burn the whole run. This is not hypothetical: an ad-hoc
 * sampler wedged during the spike, sitting on a single request for 20 minutes.
 *
 * SIZED FROM MEASURED LATENCY, and the first sizing was wrong. A 15s cap was
 * calibrated against the vendor's *degraded* behaviour and it cut off calls that
 * would have succeeded — a live run logged 20/20 HTTP 200s averaging 19.1s while
 * the handler recorded 13 of them as "unchecked". Normal baseline over 7 days is
 * p50 2.4s / p95 3.6s, so 30s is ~8x normal p95 and still a quarter of the
 * client's own timeout: generous when the vendor is healthy, still bounded when
 * it is not.
 */
const PER_CALL_TIMEOUT_MS = 30_000;

/**
 * Calls in flight at once.
 *
 * Sequential sampling makes total runtime hostage to per-call latency: at the
 * 19s average observed under load, 40 orders cannot finish inside the budget and
 * the run reports "too few checked to judge" exactly when something is wrong.
 * A small pool decouples throughput from latency while keeping the request rate
 * close to what sequential sampling produces at normal speed.
 */
const CONCURRENCY = 3;

/** Spacing between call launches. The spike saw throttling under rapid fire. */
const INTER_CALL_DELAY_MS = 250;

/** Statuses that mean SoftPro considers the file finished. */
const TERMINAL = new Set(['closed', 'completed', 'canceled', 'duplicate']);

export interface VerifyOrderSyncResult extends DriftCounts {
  /** True when the time budget stopped the run before the sample was exhausted. */
  stoppedEarly: boolean;
  /** Drift rate over `checked`, or null when nothing was checked. */
  driftPct: number | null;
  /** What SoftPro said instead, for the drifted orders. */
  driftedTo: Record<string, number>;
  sampleSize: number;
  /** Per-age-band breakdown. Reporting detail only — never weights the headline. */
  byBand: Record<string, { checked: number; drifted: number }>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Races a promise against a timeout. The underlying request is abandoned rather
 * than cancelled — the SoftPro client owns its own socket — but the run moves
 * on, which is the property that matters. At most `sampleSize` requests can be
 * outstanding, so this cannot grow unbounded.
 */
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | { __timedOut: true }> {
  return Promise.race([p, sleep(ms).then(() => ({ __timedOut: true }) as const)]);
}

/**
 * Simple random sample of the `in_process` population.
 *
 * Deliberately NOT equal-allocation stratified. Drift varies sharply by age
 * (~11% under 30 days, ~36% at 30-90 days, ~18% at 90-180), and the bands are
 * very unevenly sized (917 / 1,759 / 1,132 / 202). Taking an equal number from
 * each band would over-represent the small old-file band by 5x and understate
 * the true rate — roughly 21% against an actual 24%. A stratified draw only
 * helps if the results are re-weighted by population, and an unweighted headline
 * is exactly the kind of quietly-wrong number this job exists to catch.
 *
 * So: random draw for an unbiased headline rate, with the age band recorded per
 * order for breakdown only. It never influences the top-line number.
 *
 * `md5(file_number || today)` makes the draw stable within a day and rotated
 * across days — reruns are reproducible, and coverage still spreads over time.
 */
async function sampleInProcessOrders(limit: number) {
  const rows = await db.execute(sql`
    select id, file_number,
           case
             when opened_at > now() - interval '30 days'  then '<30d'
             when opened_at > now() - interval '90 days'  then '30-90d'
             when opened_at > now() - interval '180 days' then '90-180d'
             else '>180d'
           end as band
    from orders
    where operational_status = 'in_process'
    order by md5(file_number || to_char(now(), 'YYYY-MM-DD'))
    limit ${limit}
  `) as unknown as Array<{ id: number; file_number: string; band: string }>;
  return rows;
}

export async function handleVerifyOrderSync(
  payload: Record<string, unknown> = {},
): Promise<VerifyOrderSyncResult> {
  const sample = await sampleInProcessOrders(DRIFT_SAMPLE_SIZE);
  const deadline = createDeadline('softpro.verify_sync');

  let checked = 0;
  let drifted = 0;
  let unchecked = 0;
  const driftedTo: Record<string, number> = {};
  const byBand: Record<string, { checked: number; drifted: number }> = {};
  let stoppedEarly = false;
  let attempted = 0;

  let cursor = 0;
  async function worker() {
    for (;;) {
      // The deadline is checked before claiming the next order — never
      // mid-call — so there is always room for one worst-case unit inside the
      // 300s function ceiling.
      if (deadline.exceeded()) {
        stoppedEarly = true;
        return;
      }
      const index = cursor++;
      if (index >= sample.length) return;
      const order = sample[index]!;
      attempted++;

      const raced = await withTimeout(
        getOrderDetails({ dateFrom: '', orderNumber: order.file_number, orderId: order.id })
          .catch(() => null),
        PER_CALL_TIMEOUT_MS,
      );

      // A timeout or a failed call is UNCHECKED — we learned nothing about this
      // order. It must never enter the drift denominator, or a bad SoftPro day
      // would read as an improvement.
      if (raced === null || (raced as { __timedOut?: true }).__timedOut) {
        unchecked++;
        await sleep(INTER_CALL_DELAY_MS);
        continue;
      }

      const result = raced as Awaited<ReturnType<typeof getOrderDetails>>;
      const detail = result.success && result.data
        ? (result.data.find((d) => d.OrderNumber === order.file_number) ?? null)
        : null;
      const mapped = detail ? mapStatus(detail.OrderStatus) : null;

      if (!detail || mapped === null) {
        unchecked++;
        await sleep(INTER_CALL_DELAY_MS);
        continue;
      }

      checked++;
      byBand[order.band] ??= { checked: 0, drifted: 0 };
      byBand[order.band]!.checked++;
      if (TERMINAL.has(mapped)) {
        drifted++;
        byBand[order.band]!.drifted++;
        driftedTo[detail.OrderStatus] = (driftedTo[detail.OrderStatus] ?? 0) + 1;
      }

      await sleep(INTER_CALL_DELAY_MS);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, sample.length) }, () => worker()),
  );

  const result: VerifyOrderSyncResult = {
    checked,
    drifted,
    unchecked,
    notSampled: sample.length - attempted,
    stoppedEarly,
    driftPct: checked > 0 ? (drifted / checked) * 100 : null,
    driftedTo,
    sampleSize: sample.length,
    byBand,
  };

  await recordRunCounts(payload, result);
  return result;
}

/**
 * Persists the counts onto this job's own `jobs` row.
 *
 * The runner does not store handler return values — `jobs.payload` holds only
 * the input — so without this there is nothing for the panel to trend. Writing
 * to our own job row keeps that inside the job-tracking table and touches no
 * order data. Failure here must never fail the detector.
 */
async function recordRunCounts(
  payload: Record<string, unknown>,
  result: VerifyOrderSyncResult,
): Promise<void> {
  const jobId = typeof payload.__jobId === 'number' ? payload.__jobId : null;
  if (jobId === null) return;
  try {
    await db
      .update(jobs)
      .set({ payload: { ...payload, __jobId: undefined, statusDrift: result } })
      .where(eq(jobs.id, jobId));
  } catch {
    /* trending is best-effort; never fail the run over it */
  }
}

export async function verifySingleOrder(
  orderId: number,
  fileNumber: string,
): Promise<{ changes: Array<{ field: string; oldValue: string | null; newValue: string | null }>; updated: boolean }> {
  const result = await getOrderContacts(fileNumber);
  if (!result.success || !result.data) {
    return { changes: [], updated: false };
  }

  const mapped = mapOrderContacts(result.data);
  const changes: Array<{ field: string; oldValue: string | null; newValue: string | null }> = [];

  const existingParties = await db
    .select()
    .from(orderParties)
    .where(eq(orderParties.orderId, orderId));

  const partyChecks: Array<{ role: string; value: string | null; nameField: 'externalName' | 'externalCompany' }> = [
    { role: 'buyer', value: mapped.parties.buyer?.name ?? mapped.primaryBuyer, nameField: 'externalName' },
    { role: 'seller', value: mapped.parties.seller?.name ?? mapped.primarySeller, nameField: 'externalName' },
    { role: 'lender', value: mapped.parties.lender?.companyName ?? mapped.lenderCompanyCode, nameField: 'externalCompany' },
    { role: 'escrow_company', value: mapped.parties.escrowCompany?.companyName ?? mapped.escrowCompanyCode, nameField: 'externalCompany' },
  ];

  for (const check of partyChecks) {
    const local = existingParties.find((p: ExistingParty) => p.role === check.role && p.isPrimary !== false);
    const spValue = check.value;
    const localValue = local?.[check.nameField] ?? null;

    if (spValue && spValue !== localValue) {
      changes.push({ field: `${check.role}.${check.nameField}`, oldValue: localValue, newValue: spValue });
    }
  }

  if (changes.length > 0) {
    await reconcileParties(orderId, mapped);

    const [orderRow] = await db
      .select({ titleOfficerId: orders.titleOfficerId, escrowOfficerId: orders.escrowOfficerId, salesRepId: orders.salesRepId })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);
    if (orderRow) {
      await reconcileOfficers({ id: orderId, ...orderRow }, mapped);
    }
  }

  return { changes, updated: changes.length > 0 };
}

async function reconcileParties(orderId: number, mapped: MappedOrderContacts): Promise<number> {
  const existing = await db
    .select()
    .from(orderParties)
    .where(eq(orderParties.orderId, orderId));

  let changeCount = 0;

  const updates: Array<{ role: string; isPrimary: boolean; name: string | null; company: string | null }> = [
    { role: 'buyer', isPrimary: true, name: mapped.parties.buyer?.name ?? mapped.primaryBuyer, company: mapped.parties.buyer?.companyName ?? null },
    { role: 'buyer', isPrimary: false, name: mapped.parties.secondaryBuyer?.name ?? mapped.secondaryBuyer, company: mapped.parties.secondaryBuyer?.companyName ?? null },
    { role: 'seller', isPrimary: true, name: mapped.parties.seller?.name ?? mapped.primarySeller, company: null },
    { role: 'seller', isPrimary: false, name: mapped.parties.secondarySeller?.name ?? mapped.secondarySeller, company: null },
    { role: 'lender', isPrimary: true, name: mapped.parties.lender?.name ?? null, company: mapped.parties.lender?.companyName ?? mapped.lenderCompanyCode },
    { role: 'escrow_company', isPrimary: true, name: mapped.parties.escrowCompany?.name ?? null, company: mapped.parties.escrowCompany?.companyName ?? mapped.escrowCompanyCode },
  ];

  for (const u of updates) {
    if (!u.name && !u.company) continue;

    const match = existing.find((p: ExistingParty) => p.role === u.role && p.isPrimary === u.isPrimary);
    if (match) {
      const nameChanged = u.name && match.externalName !== u.name;
      const companyChanged = u.company && match.externalCompany !== u.company;
      if (nameChanged || companyChanged) {
        await db.update(orderParties).set({
          ...(nameChanged ? { externalName: u.name } : {}),
          ...(companyChanged ? { externalCompany: u.company } : {}),
        }).where(eq(orderParties.id, match.id));
        changeCount++;
      }
    } else {
      await db.insert(orderParties).values({
        orderId,
        role: u.role as typeof orderParties.role.enumValues[number],
        isPrimary: u.isPrimary,
        externalName: u.name,
        externalCompany: u.company,
      });
      changeCount++;
    }
  }

  return changeCount;
}

async function reconcileOfficers(
  order: { id: number; titleOfficerId: number | null; escrowOfficerId: number | null; salesRepId: number | null },
  mapped: MappedOrderContacts,
): Promise<number> {
  let changeCount = 0;
  const updates: Partial<typeof orders.$inferInsert> = {};

  const titleOfficerLookupCode = mapped.parties.titleCompany?.lookupCode ?? mapped.titleOfficerName;
  if (titleOfficerLookupCode && !order.titleOfficerId) {
    const contact = await findContactByLookupCode(titleOfficerLookupCode);
    if (contact) {
      updates.titleOfficerId = contact.id;
      changeCount++;
    }
  }

  if (mapped.escrowPersonCode && !order.escrowOfficerId) {
    const contact = await findContactByLookupCode(mapped.escrowPersonCode);
    if (contact) {
      updates.escrowOfficerId = contact.id;
      changeCount++;
    }
  }

  if (changeCount > 0) {
    await db.update(orders).set({ ...updates, updatedAt: new Date() }).where(eq(orders.id, order.id));
  }

  return changeCount;
}

async function findContactByLookupCode(code: string) {
  const [contact] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(sql`${contacts.softproLookupCode} = ${code} OR ${contacts.fullName} = ${code}`)
    .limit(1);
  return contact ?? null;
}
