import { db } from '@/lib/db/client';
import { orders, orderParties, contacts, companies, vendorApiLogs, jobs } from '@/lib/db/schema';
import { eq, and, isNull, or, sql } from 'drizzle-orm';
import { getOrderContacts, mapOrderContacts } from '@/lib/integrations/softpro';
import { budgetMsFor } from '@/lib/jobs/time-budget';
import type { MappedOrderContacts, MappedResolvedParty } from '@/lib/integrations/softpro';
import type { SoftProOrderContactsData } from '@/lib/integrations/softpro/types';
import { resolveClientContactId } from '@/lib/domain/orders/client-resolver';

// ─── Types ───────────────────────────────────────────────────────────────────

export type EnrichOutcome = 'parties_written' | 'empty_confirmed' | 'fk_only' | 'failed';

export interface EnrichOrdersResult {
  total: number;
  attempted: number;
  partiesWritten: number;
  fkOnly: number;
  emptyConfirmed: number;
  failed: number;
  batchLimit: number;
  timeBudgetMs: number;
  stoppedEarly: boolean;
  singleFlightSkipped: boolean;
  runningJobId: number | null;
  errors: Array<{ fileNumber: string; error: string }>;
}

export interface EnrichSingleResult {
  success: boolean;
  orderId: number;
  fileNumber: string;
  resolved: Record<string, number | null>;
  unresolved: string[];
  partiesWritten: number;
  contactsEmptyConfirmed: boolean;
  outcome: EnrichOutcome;
  error?: string;
}

interface OrderFkUpdates {
  lenderId: number | null;
  listingAgentId: number | null;
  titleCompanyId: number | null;
  underwriterId: number | null;
  clientContactId: number | null;
}

interface ResolvedPartyIdentity {
  name: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  contactId: number | null;
}

interface EnrichOrdersPayload {
  __jobId?: unknown;
}

const ENRICH_ORDERS_MAX_DURATION_MS = 300_000;
const DEFAULT_ENRICH_ORDERS_BATCH_SIZE = 25;

/**
 * How long `contacts_empty_confirmed` suppresses a re-read.
 *
 * The flag used to be terminal. Line 246 below is the only writer that can
 * clear it, and reaching it required passing the batch picker's own
 * `contacts_empty_confirmed = false` filter — so a true value excluded an order
 * from every scheduled run forever. 96 orders were latched with zero party rows
 * when this was measured, all of them `in_process`, and one of the two sampled
 * (`20021133-ONT`) had since acquired a real borrower in SoftPro that no
 * scheduled job would ever have collected. See
 * docs/tickets/SOFTPRO_MISSING_BUYER.md §3.
 *
 * The flag is still worth having: its job is to stop re-polling an order the
 * vendor genuinely holds nothing for every six hours, which is a real saving.
 * So it expires rather than terminates — a latched order rejoins the queue once
 * its last read is this old.
 *
 * SIZED AGAINST MEASURED COST. The eligible population is 399 orders under the
 * old predicate and 489 under this one; deleting the flag outright gives 495.
 * Because a run is capped at SOFTPRO_ENRICH_ORDERS_BATCH_SIZE, per-run call
 * volume does not move at all — what changes is the drain rate. At 7 days the
 * 90 newly-reachable orders cost ~90 extra GetOrderContacts calls per week
 * against a measured baseline of ~2,300 per day: +0.55%. Deleting the flag
 * would re-read all 96 every 6 hours instead — ~384 calls/day, +17% — and would
 * keep doing it forever for orders SoftPro has nothing for.
 */
const CONTACTS_EMPTY_RETRY_INTERVAL = '7 days';

/** Normal staleness gate for orders that are not latched. */
const CONTACTS_FETCH_STALE_INTERVAL = '6 hours';
// Was ENRICH_ORDERS_MAX_DURATION_MS * 0.8 = 240s, which left no room for a
// worst-case unit (get_order_contacts can reach its 60s client timeout):
// 240 + 60 = 300, exactly the ceiling. Now sized from the measured unit p99.
// See src/lib/jobs/time-budget.ts.
const DEFAULT_ENRICH_ORDERS_TIME_BUDGET_MS = budgetMsFor('softpro.enrich_orders');
export const ENRICH_ORDERS_RUNNING_WINDOW_MS = 10 * 60 * 1000;

function positiveIntegerFromEnv(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (!raw) return defaultValue;

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

function enrichOrdersBatchLimit(): number {
  return positiveIntegerFromEnv('SOFTPRO_ENRICH_ORDERS_BATCH_SIZE', DEFAULT_ENRICH_ORDERS_BATCH_SIZE);
}

function enrichOrdersTimeBudgetMs(): number {
  return positiveIntegerFromEnv('SOFTPRO_ENRICH_ORDERS_TIME_BUDGET_MS', DEFAULT_ENRICH_ORDERS_TIME_BUDGET_MS);
}

function emptyEnrichOrdersResult(
  batchLimit: number,
  timeBudgetMs: number,
  overrides: Partial<Pick<EnrichOrdersResult, 'singleFlightSkipped' | 'runningJobId'>> = {},
): EnrichOrdersResult {
  return {
    total: 0,
    attempted: 0,
    partiesWritten: 0,
    fkOnly: 0,
    emptyConfirmed: 0,
    failed: 0,
    batchLimit,
    timeBudgetMs,
    stoppedEarly: false,
    singleFlightSkipped: overrides.singleFlightSkipped ?? false,
    runningJobId: overrides.runningJobId ?? null,
    errors: [],
  };
}

async function findPriorRunningEnrichOrderJob(currentJobId: number | null): Promise<{ id: number } | null> {
  const activeSince = new Date(Date.now() - ENRICH_ORDERS_RUNNING_WINDOW_MS).toISOString();
  const idFilter = currentJobId === null
    ? sql``
    : sql`AND ${jobs.id} < ${currentJobId}`;

  const [runningJob] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(sql`
      ${jobs.status} = 'running'
      AND ${jobs.jobType} IN ('softpro.enrich_orders', 'enrich-orders')
      AND ${jobs.startedAt} >= ${activeSince}
      ${idFilter}
    `)
    .limit(1);

  return runningJob ?? null;
}

// ─── Single Order Enrichment ─────────────────────────────────────────────────

export async function enrichSingleOrder(orderId: number): Promise<EnrichSingleResult> {
  const [order] = await db.select({ id: orders.id, fileNumber: orders.fileNumber, orderType: orders.orderType })
    .from(orders).where(eq(orders.id, orderId)).limit(1);

  if (!order) {
    return {
      success: false,
      orderId,
      fileNumber: '',
      resolved: {},
      unresolved: [],
      partiesWritten: 0,
      contactsEmptyConfirmed: false,
      outcome: 'failed',
      error: 'Order not found',
    };
  }

  return enrichOrder(order);
}

async function enrichOrder(order: { id: number; fileNumber: string; orderType: string | null }): Promise<EnrichSingleResult> {
  const result: EnrichSingleResult = {
    success: false,
    orderId: order.id,
    fileNumber: order.fileNumber,
    resolved: {},
    unresolved: [],
    partiesWritten: 0,
    contactsEmptyConfirmed: false,
    outcome: 'failed',
  };

  const startedAt = new Date();

  const apiResult = await getOrderContacts(order.fileNumber);
  if (!apiResult.success || !apiResult.data) {
    result.error = apiResult.error?.message ?? 'GetOrderContacts returned no data';
    await logEnrichAttempt(order.id, order.fileNumber, startedAt, result);
    return result;
  }

  const data = apiResult.data;
  const mapped = mapOrderContacts(data);
  const updates: OrderFkUpdates = {
    lenderId: null,
    listingAgentId: null,
    titleCompanyId: null,
    underwriterId: null,
    clientContactId: null,
  };

  const lenderCode = mapped.lenderCode;
  if (lenderCode || mapped.parties.lender?.name) {
    const id = await ensureContactFromResolved(mapped.parties.lender, { isLender: true })
      ?? (lenderCode ? await resolveContact(lenderCode) : null);
    updates.lenderId = id;
    if (id) {
      result.resolved.lenderId = id;
      await refreshContactFromResolved(id, mapped.parties.lender);
    }
    else result.unresolved.push(`Lenders.PersonLookupCode=${lenderCode}`);
  }

  const listingCode = mapped.listingAgentPersonCode;
  if (listingCode || mapped.parties.listingAgent?.name) {
    const id = await ensureContactFromResolved(mapped.parties.listingAgent, { isRealEstateAgent: true })
      ?? (listingCode ? await resolveContact(listingCode) : null);
    updates.listingAgentId = id;
    if (id) {
      result.resolved.listingAgentId = id;
      await refreshContactFromResolved(id, mapped.parties.listingAgent);
      await flagRealEstateAgentAndCompany(id);
    } else result.unresolved.push(`ListingAgentBrokers.PersonLookupCode=${listingCode}`);
  }

  const titleCompanyCode = mapped.titleCompanyCode;
  if (titleCompanyCode || mapped.parties.titleCompany?.companyName) {
    const id = await ensureCompanyFromResolved(mapped.parties.titleCompany)
      ?? (titleCompanyCode ? await resolveCompany(titleCompanyCode) : null);
    updates.titleCompanyId = id;
    if (id) {
      result.resolved.titleCompanyId = id;
      await refreshCompanyFromResolved(id, mapped.parties.titleCompany);
    }
    else result.unresolved.push(`TitleCompanies.CompanyLookUpCode=${titleCompanyCode}`);
  }

  const underwriterCode = mapped.underwriterCompanyCode;
  if (underwriterCode || mapped.parties.underwriter?.companyName) {
    const id = await ensureCompanyFromResolved(mapped.parties.underwriter, { isUnderwriter: true })
      ?? (underwriterCode ? await resolveCompany(underwriterCode) : null);
    updates.underwriterId = id;
    if (id) {
      result.resolved.underwriterId = id;
      await refreshCompanyFromResolved(id, mapped.parties.underwriter);
    }
    else result.unresolved.push(`Underwriters.CompanyLookUpCode=${underwriterCode}`);
  }

  const clientContactId = await resolveClientContactId(order.orderType, data);
  if (clientContactId) {
    updates.clientContactId = clientContactId;
    result.resolved.clientContactId = clientContactId;
  }

  const setFields: Record<string, unknown> = { updatedAt: new Date() };
  let hasUpdate = false;
  for (const [key, val] of Object.entries(updates)) {
    if (val !== null) {
      setFields[key] = val;
      hasUpdate = true;
    }
  }

  const contactsEmptyConfirmed = softProContactsEmpty(data, mapped);
  result.contactsEmptyConfirmed = contactsEmptyConfirmed;
  setFields.contactsEmptyConfirmed = contactsEmptyConfirmed;

  if (hasUpdate || contactsEmptyConfirmed) {
    await db.update(orders).set(setFields).where(eq(orders.id, order.id));
  }

  result.partiesWritten = await persistResolvedParties(order.id, mapped, updates);

  if (result.partiesWritten > 0) {
    result.outcome = 'parties_written';
    result.success = true;
    await db.update(orders)
      .set({ contactsEmptyConfirmed: false, updatedAt: new Date() })
      .where(eq(orders.id, order.id));
    result.contactsEmptyConfirmed = false;
  } else if (contactsEmptyConfirmed) {
    result.outcome = 'empty_confirmed';
    result.success = true;
  } else if (Object.keys(result.resolved).length > 0) {
    result.outcome = 'fk_only';
    result.success = false;
  } else {
    result.outcome = 'failed';
    result.success = false;
  }

  await logEnrichAttempt(order.id, order.fileNumber, startedAt, result);
  return result;
}

// ─── Batch Enrichment ────────────────────────────────────────────────────────

export async function handleEnrichOrders(payload: EnrichOrdersPayload = {}): Promise<EnrichOrdersResult> {
  const startedAt = Date.now();
  const batchLimit = enrichOrdersBatchLimit();
  const timeBudgetMs = enrichOrdersTimeBudgetMs();
  const currentJobId = typeof payload.__jobId === 'number' ? payload.__jobId : null;
  const runningJob = await findPriorRunningEnrichOrderJob(currentJobId);

  if (runningJob) {
    return emptyEnrichOrdersResult(batchLimit, timeBudgetMs, {
      singleFlightSkipped: true,
      runningJobId: runningJob.id,
    });
  }

  const unenriched = await db
    .select({ id: orders.id, fileNumber: orders.fileNumber, orderType: orders.orderType })
    .from(orders)
    .where(
      and(
        or(
          and(
            isNull(orders.lenderId),
            isNull(orders.listingAgentId),
            isNull(orders.titleCompanyId),
            isNull(orders.underwriterId),
          ),
          isNull(orders.clientContactId),
          sql`NOT EXISTS (SELECT 1 FROM ${orderParties} op WHERE op.order_id = ${orders.id})`,
        ),
        // The latch and the staleness gate are ONE condition, not two ANDed
        // arms. Keeping them separate is what made the flag terminal: an order
        // had to clear the latch filter to reach the writer that clears the
        // latch. Expressed as a per-order interval there is no such cycle —
        // being latched lengthens the retry gap instead of closing it.
        contactsFetchDue(),
      )
    )
    .orderBy(sql`${orders.lastContactsFetchAt} ASC NULLS FIRST`)
    .limit(batchLimit);

  const stats: EnrichOrdersResult = {
    total: unenriched.length,
    attempted: 0,
    partiesWritten: 0,
    fkOnly: 0,
    emptyConfirmed: 0,
    failed: 0,
    batchLimit,
    timeBudgetMs,
    stoppedEarly: false,
    singleFlightSkipped: false,
    runningJobId: null,
    errors: [],
  };

  for (const order of unenriched) {
    if (Date.now() - startedAt >= timeBudgetMs) {
      stats.stoppedEarly = true;
      break;
    }

    try {
      await db.update(orders)
        .set({ lastContactsFetchAt: sql`NOW()` })
        .where(eq(orders.id, order.id));

      stats.attempted++;
      const result = await enrichOrder(order);

      switch (result.outcome) {
        case 'parties_written':
          stats.partiesWritten++;
          break;
        case 'empty_confirmed':
          stats.emptyConfirmed++;
          break;
        case 'fk_only':
          stats.fkOnly++;
          break;
        case 'failed':
          stats.failed++;
          if (result.error) {
            stats.errors.push({ fileNumber: order.fileNumber, error: result.error });
          }
          break;
      }
    } catch (err) {
      stats.failed++;
      stats.errors.push({
        fileNumber: order.fileNumber,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  return stats;
}

// ─── Re-enrich the orders the old one-way latch stranded ─────────────────────
//
// A backfill, not a new writer. The live path calls `enrichSingleOrder`, so the
// 96 stranded orders go through the same mapper, the same identity resolution
// and the same `upsertResolvedParty` as every other order — a one-off writer
// would be a second way to produce party rows, which is how the two defects
// this fixes came to differ from each other in the first place.
//
// The dry run resolves everything the writer would resolve and writes nothing.
// It is not a summary: it lists every order and every party row, including the
// resolved `externalEmail`, because that field is the one that decides whether
// anybody new gets emailed.

/** Enough headroom for the whole latched population in one pass. */
const REENRICH_LATCHED_DEFAULT_LIMIT = 250;

export interface ReenrichLatchedPayload {
  /** Resolve and report everything; write nothing, send nothing. */
  dryRun?: boolean;
  limit?: number;
  /** Overrides the Vercel-sized budget. Only a local run should set this. */
  timeBudgetMs?: number;
  __jobId?: unknown;
}

/** Injectable vendor read, so a local dry run can avoid appending call logs. */
export interface ReenrichLatchedDeps {
  readContacts?: (fileNumber: string) => Promise<{
    success: boolean;
    data?: SoftProOrderContactsData | null;
    error?: { message: string } | null;
  }>;
}

export interface ReenrichPlannedParty {
  role: PartyRole;
  isPrimary: boolean;
  externalName: string | null;
  externalCompany: string | null;
  /** The field that changes who gets emailed. Never summarised away. */
  externalEmail: string | null;
  externalPhone: string | null;
  contactId: number | null;
}

export interface ReenrichReportRow {
  orderId: number;
  fileNumber: string;
  transactionType: string | null;
  operationalStatus: string | null;
  lastContactsFetchAt: string | null;
  existingPartyRows: number;
  vendorRead: 'ok' | 'failed';
  vendorError: string | null;
  /** SoftPro still holds nothing — the order stays latched, retried in 7 days. */
  stillEmpty: boolean;
  wouldWrite: ReenrichPlannedParty[];
}

export interface ReenrichLatchedResult {
  dryRun: boolean;
  /** Latched orders with zero party rows, i.e. the population. */
  scanned: number;
  attempted: number;
  vendorReadFailed: number;
  /** Orders that would gain at least one party row. */
  ordersWithNewParties: number;
  /** Total party rows across those orders. */
  partyRowsPlanned: number;
  /** Orders SoftPro still has nothing for. */
  ordersStillEmpty: number;
  /** Party rows carrying an email — the recipient-changing subset. */
  partyRowsWithEmail: number;
  /** Live-run only. */
  partiesWritten: number;
  failed: number;
  stoppedEarly: boolean;
  errors: Array<{ fileNumber: string; error: string }>;
  /** Dry run only. One row per order, nothing omitted. */
  report?: ReenrichReportRow[];
  reportNote?: string;
}

const REENRICH_REPORT_NOTE =
  'Party rows are previewed with the same mapper and the same identity '
  + 'resolution the writer uses, so externalEmail here is the value that would '
  + 'be stored. Foreign-key resolution (lender_id, listing_agent_id, '
  + 'title_company_id, underwriter_id) is NOT previewed because resolving it '
  + 'creates contacts and companies rows; every order in this population holds '
  + 'zero party rows today, so no FK-only row is being hidden.';

export async function handleReenrichLatchedOrders(
  payload: ReenrichLatchedPayload = {},
  deps: ReenrichLatchedDeps = {},
): Promise<ReenrichLatchedResult> {
  const dryRun = payload.dryRun === true;
  const limit = typeof payload.limit === 'number' && payload.limit > 0
    ? payload.limit
    : REENRICH_LATCHED_DEFAULT_LIMIT;
  const readContacts = deps.readContacts ?? getOrderContacts;
  const budgetMs = typeof payload.timeBudgetMs === 'number' && payload.timeBudgetMs > 0
    ? payload.timeBudgetMs
    : enrichOrdersTimeBudgetMs();
  const startedAt = Date.now();

  // Deterministic and identical for the dry run and the live run that follows
  // it: oldest read first, id breaking ties. A preview of a different set is
  // not a preview.
  const latched = await db
    .select({
      id: orders.id,
      fileNumber: orders.fileNumber,
      orderType: orders.orderType,
      transactionType: orders.transactionType,
      operationalStatus: orders.operationalStatus,
      lastContactsFetchAt: orders.lastContactsFetchAt,
    })
    .from(orders)
    .where(and(
      eq(orders.contactsEmptyConfirmed, true),
      sql`NOT EXISTS (SELECT 1 FROM ${orderParties} op WHERE op.order_id = ${orders.id})`,
    ))
    .orderBy(sql`${orders.lastContactsFetchAt} ASC NULLS FIRST`, orders.id)
    .limit(limit);

  const result: ReenrichLatchedResult = {
    dryRun,
    scanned: latched.length,
    attempted: 0,
    vendorReadFailed: 0,
    ordersWithNewParties: 0,
    partyRowsPlanned: 0,
    ordersStillEmpty: 0,
    partyRowsWithEmail: 0,
    partiesWritten: 0,
    failed: 0,
    stoppedEarly: false,
    errors: [],
  };

  if (dryRun) {
    result.report = [];
    result.reportNote = REENRICH_REPORT_NOTE;
  }

  for (const order of latched) {
    if (Date.now() - startedAt >= budgetMs) {
      result.stoppedEarly = true;
      break;
    }
    result.attempted++;

    if (!dryRun) {
      try {
        const enriched = await enrichSingleOrder(order.id);
        result.partiesWritten += enriched.partiesWritten;
        if (enriched.partiesWritten > 0) result.ordersWithNewParties++;
        else if (enriched.contactsEmptyConfirmed) result.ordersStillEmpty++;
        if (enriched.outcome === 'failed') {
          result.failed++;
          if (enriched.error) {
            result.errors.push({ fileNumber: order.fileNumber, error: enriched.error });
          }
        }
      } catch (err) {
        result.failed++;
        result.errors.push({
          fileNumber: order.fileNumber,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
      continue;
    }

    const row: ReenrichReportRow = {
      orderId: order.id,
      fileNumber: order.fileNumber,
      transactionType: order.transactionType,
      operationalStatus: order.operationalStatus,
      lastContactsFetchAt: order.lastContactsFetchAt?.toISOString() ?? null,
      existingPartyRows: 0,
      vendorRead: 'ok',
      vendorError: null,
      stillEmpty: false,
      wouldWrite: [],
    };

    const apiResult = await readContacts(order.fileNumber);
    if (!apiResult.success || !apiResult.data) {
      row.vendorRead = 'failed';
      row.vendorError = apiResult.error?.message ?? 'GetOrderContacts returned no data';
      result.vendorReadFailed++;
      result.report!.push(row);
      continue;
    }

    const mapped = mapOrderContacts(apiResult.data);
    row.wouldWrite = await previewPartyRows(mapped);
    row.stillEmpty = row.wouldWrite.length === 0;

    if (row.wouldWrite.length > 0) {
      result.ordersWithNewParties++;
      result.partyRowsPlanned += row.wouldWrite.length;
      result.partyRowsWithEmail += row.wouldWrite.filter((p) => p.externalEmail).length;
    } else {
      result.ordersStillEmpty++;
    }

    result.report!.push(row);
  }

  console.log(
    `[reenrich-latched]${dryRun ? ' DRY RUN' : ''} scanned=${result.scanned} `
    + `attempted=${result.attempted} orders_with_parties=${result.ordersWithNewParties} `
    + `party_rows=${dryRun ? result.partyRowsPlanned : result.partiesWritten} `
    + `rows_with_email=${result.partyRowsWithEmail} `
    + `still_empty=${result.ordersStillEmpty} read_failed=${result.vendorReadFailed} `
    + `failed=${result.failed} stopped_early=${result.stoppedEarly}`,
  );

  return result;
}

/**
 * What `persistResolvedParties` would store, resolved but not written.
 *
 * Shares `plannedPartyRows` and `resolvePartyIdentityFromMaster` with the
 * writer, and repeats its "nothing usable, skip the row" rule, so the preview
 * cannot drift from the write. Every statement it issues is a SELECT.
 */
async function previewPartyRows(mapped: MappedOrderContacts): Promise<ReenrichPlannedParty[]> {
  const noFks: OrderFkUpdates = {
    lenderId: null, listingAgentId: null, titleCompanyId: null,
    underwriterId: null, clientContactId: null,
  };

  const planned: ReenrichPlannedParty[] = [];
  for (const row of plannedPartyRows(mapped, noFks)) {
    if (!row.party) continue;
    const identity = await resolvePartyIdentityFromMaster(row.party, null, null);
    if (!identity.name && !identity.company && !identity.email && !identity.phone) continue;
    planned.push({
      role: row.role,
      isPrimary: row.isPrimary,
      externalName: identity.name,
      externalCompany: identity.company,
      externalEmail: identity.email,
      externalPhone: identity.phone,
      contactId: identity.contactId,
    });
  }
  return planned;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Is this order due for a contacts read?
 *
 * A never-fetched order is always due. Otherwise the gap depends on whether the
 * last read came back empty: CONTACTS_FETCH_STALE_INTERVAL normally,
 * CONTACTS_EMPTY_RETRY_INTERVAL when `contacts_empty_confirmed` is set. The
 * flag therefore throttles rather than excludes, and an order that stays empty
 * is re-read on the long cadence indefinitely instead of never again.
 */
export function contactsFetchDue() {
  return or(
    isNull(orders.lastContactsFetchAt),
    sql`${orders.lastContactsFetchAt} < NOW() - CASE
          WHEN ${orders.contactsEmptyConfirmed} IS TRUE
            THEN INTERVAL '${sql.raw(CONTACTS_EMPTY_RETRY_INTERVAL)}'
          ELSE INTERVAL '${sql.raw(CONTACTS_FETCH_STALE_INTERVAL)}'
        END`,
  );
}

function softProContactsEmpty(data: SoftProOrderContactsData, mapped: MappedOrderContacts): boolean {
  const hasParty = Object.values(mapped.parties).some((party) => party !== null);
  const hasLookupCode = [
    mapped.escrowCompanyCode,
    mapped.escrowPersonCode,
    mapped.lenderCompanyCode,
    mapped.lenderCode,
    mapped.listingAgentCompanyCode,
    mapped.listingAgentPersonCode,
    mapped.mortgageBrokerCode,
    mapped.payoffLenderCode,
    mapped.titleCompanyCode,
    mapped.underwriterCompanyCode,
    mapped.underwriterPersonCode,
  ].some((code) => code !== null);
  const hasBorrowerSeller = [
    mapped.primaryBuyer,
    mapped.secondaryBuyer,
    mapped.primarySeller,
    mapped.secondarySeller,
  ].some((name) => name !== null);

  if (hasParty || hasLookupCode || hasBorrowerSeller) return false;

  return softProValueEmpty(data);
}

function softProValueEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.every(softProValueEmpty);
  if (typeof value === 'object') return Object.values(value).every(softProValueEmpty);
  return false;
}

async function logEnrichAttempt(
  orderId: number,
  fileNumber: string,
  startedAt: Date,
  result: EnrichSingleResult,
): Promise<void> {
  try {
    await db.insert(vendorApiLogs).values({
      vendor: 'softpro',
      operation: 'enrich_order_contacts',
      orderId,
      requestId: crypto.randomUUID(),
      startedAt,
      endedAt: new Date(),
      success: result.outcome !== 'failed',
      requestMeta: {
        fileNumber,
        outcome: result.outcome,
        partiesWritten: result.partiesWritten,
        contactsEmptyConfirmed: result.contactsEmptyConfirmed,
        fkResolved: Object.keys(result.resolved),
        unresolved: result.unresolved,
        error: result.error ?? null,
      } as Record<string, unknown>,
    });
  } catch {
    /* logging must not break enrichment */
  }
}

async function resolveContact(lookupCode: string): Promise<number | null> {
  const [row] = await db.select({ id: contacts.id })
    .from(contacts)
    .where(or(
      eq(contacts.lookupCode, lookupCode),
      eq(contacts.softproLookupCode, lookupCode),
      eq(contacts.sourceId, lookupCode),
    ))
    .limit(1);
  return row?.id ?? null;
}

async function loadContactIdentity(contactId: number): Promise<ResolvedPartyIdentity> {
  const [row] = await db.select({
    id: contacts.id,
    fullName: contacts.fullName,
    email: contacts.email,
    phone: contacts.phone,
    companyName: contacts.companyName,
  })
    .from(contacts)
    .where(eq(contacts.id, contactId))
    .limit(1);

  if (!row) {
    return { name: null, company: null, email: null, phone: null, contactId: null };
  }

  return {
    name: row.fullName,
    company: row.companyName,
    email: row.email,
    phone: row.phone,
    contactId: row.id,
  };
}

async function loadCompanyIdentity(companyId: number): Promise<ResolvedPartyIdentity> {
  const [row] = await db.select({
    name: companies.name,
    email: companies.email,
    phone: companies.phone,
  })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);

  if (!row) {
    return { name: null, company: null, email: null, phone: null, contactId: null };
  }

  return {
    name: null,
    company: row.name,
    email: row.email,
    phone: row.phone,
    contactId: null,
  };
}

async function resolvePartyIdentityFromMaster(
  party: MappedResolvedParty,
  fkContactId?: number | null,
  fkCompanyId?: number | null,
): Promise<ResolvedPartyIdentity> {
  let identity: ResolvedPartyIdentity = {
    name: party.name,
    company: party.companyName,
    email: party.email ?? party.companyEmail,
    phone: party.phone ?? party.companyPhone,
    contactId: null,
  };

  if (party.lookupCode) {
    const [contact] = await db.select({
      id: contacts.id,
      fullName: contacts.fullName,
      email: contacts.email,
      phone: contacts.phone,
      companyName: contacts.companyName,
    })
      .from(contacts)
      .where(or(
        eq(contacts.lookupCode, party.lookupCode),
        eq(contacts.softproLookupCode, party.lookupCode),
        eq(contacts.sourceId, party.lookupCode),
      ))
      .limit(1);

    if (contact) {
      identity = {
        name: identity.name ?? contact.fullName,
        company: identity.company ?? contact.companyName,
        email: identity.email ?? contact.email,
        phone: identity.phone ?? contact.phone,
        contactId: contact.id,
      };
    }
  }

  if (party.companyLookupCode) {
    const [company] = await db.select({
      name: companies.name,
      email: companies.email,
      phone: companies.phone,
    })
      .from(companies)
      .where(or(
        eq(companies.lookupCode, party.companyLookupCode),
        eq(companies.sourceId, party.companyLookupCode),
      ))
      .limit(1);

    if (company) {
      identity = {
        name: identity.name,
        company: identity.company ?? company.name,
        email: identity.email ?? company.email,
        phone: identity.phone ?? company.phone,
        contactId: identity.contactId,
      };
    }
  }

  if (fkContactId) {
    const fkIdentity = await loadContactIdentity(fkContactId);
    identity = {
      name: identity.name ?? fkIdentity.name,
      company: identity.company ?? fkIdentity.company,
      email: identity.email ?? fkIdentity.email,
      phone: identity.phone ?? fkIdentity.phone,
      contactId: identity.contactId ?? fkIdentity.contactId,
    };
  }

  if (fkCompanyId) {
    const fkIdentity = await loadCompanyIdentity(fkCompanyId);
    identity = {
      name: identity.name ?? fkIdentity.name,
      company: identity.company ?? fkIdentity.company,
      email: identity.email ?? fkIdentity.email,
      phone: identity.phone ?? fkIdentity.phone,
      contactId: identity.contactId,
    };
  }

  return identity;
}

async function flagRealEstateAgentAndCompany(contactId: number): Promise<void> {
  await db.update(contacts)
    .set({ isRealEstateAgent: true, updatedAt: new Date() })
    .where(and(
      eq(contacts.id, contactId),
      eq(contacts.isRealEstateAgent, false),
    ));

  const [agent] = await db.select({ flookupCode: contacts.flookupCode })
    .from(contacts)
    .where(eq(contacts.id, contactId))
    .limit(1);

  if (!agent?.flookupCode) return;

  await db.update(companies)
    .set({ isRealEstateCompany: true, updatedAt: new Date() })
    .where(and(
      eq(companies.lookupCode, agent.flookupCode),
      eq(companies.isRealEstateCompany, false),
    ));
}

async function resolveCompany(lookupCode: string): Promise<number | null> {
  const [row] = await db.select({ id: companies.id })
    .from(companies)
    .where(or(
      eq(companies.lookupCode, lookupCode),
      eq(companies.sourceId, lookupCode),
    ))
    .limit(1);
  return row?.id ?? null;
}

async function refreshContactFromResolved(contactId: number, party: MappedResolvedParty | null): Promise<void> {
  if (!party) return;

  const update: Partial<typeof contacts.$inferInsert> = { updatedAt: new Date() };
  if (party.name) update.fullName = party.name;
  if (party.email) update.email = party.email;
  if (party.phone) update.phone = party.phone;
  if (party.companyName) update.companyName = party.companyName;
  if (party.companyLookupCode) update.flookupCode = party.companyLookupCode;
  if (party.lookupCode) update.lookupCode = party.lookupCode;

  if (Object.keys(update).length === 1) return;
  await db.update(contacts).set(update).where(eq(contacts.id, contactId));
}

async function ensureContactFromResolved(
  party: MappedResolvedParty | null,
  flags: Partial<Pick<typeof contacts.$inferInsert, 'isLender' | 'isRealEstateAgent'>> = {},
): Promise<number | null> {
  if (!party) return null;
  const lookup = party.lookupCode;
  const name = party.name;

  const existingId = lookup ? await resolveContact(lookup) : null;
  if (existingId) return existingId;
  if (!lookup || !name) return null;

  const [inserted] = await db.insert(contacts).values({
    sourceSystem: 'softpro',
    sourceId: lookup,
    lookupCode: lookup,
    softproLookupCode: lookup,
    fullName: name,
    email: party.email,
    phone: party.phone,
    companyName: party.companyName,
    flookupCode: party.companyLookupCode,
    ...flags,
  }).returning({ id: contacts.id });

  return inserted?.id ?? null;
}

async function refreshCompanyFromResolved(companyId: number, party: MappedResolvedParty | null): Promise<void> {
  if (!party) return;

  const update: Partial<typeof companies.$inferInsert> = { updatedAt: new Date() };
  if (party.companyName) update.name = party.companyName;
  if (party.companyEmail) update.email = party.companyEmail;
  if (party.companyPhone) update.phone = party.companyPhone;
  if (party.companyLookupCode) update.lookupCode = party.companyLookupCode;

  if (Object.keys(update).length === 1) return;
  await db.update(companies).set(update).where(eq(companies.id, companyId));
}

async function ensureCompanyFromResolved(
  party: MappedResolvedParty | null,
  flags: Partial<Pick<typeof companies.$inferInsert, 'isEscrowCompany' | 'isUnderwriter'>> = {},
): Promise<number | null> {
  if (!party) return null;
  const lookup = party.companyLookupCode;
  const name = party.companyName;

  const existingId = lookup ? await resolveCompany(lookup) : null;
  if (existingId) return existingId;
  if (!lookup) return null;

  const [inserted] = await db.insert(companies).values({
    sourceSystem: 'softpro',
    sourceId: lookup,
    lookupCode: lookup,
    name: name ?? lookup,
    email: party.companyEmail,
    phone: party.companyPhone,
    ...flags,
  }).returning({ id: companies.id });

  return inserted?.id ?? null;
}

type PartyRole = typeof orderParties.role.enumValues[number];

export interface PartyUpsert {
  role: PartyRole;
  isPrimary: boolean;
  party: MappedResolvedParty | null;
  contactId?: number | null;
  companyId?: number | null;
}

/**
 * The party rows one GetOrderContacts response maps to.
 *
 * Exported and shared so the re-enrichment dry run previews exactly what the
 * writer would write. A preview built from its own list is a preview of a
 * different run.
 */
export function plannedPartyRows(
  mapped: MappedOrderContacts,
  updates: OrderFkUpdates,
): PartyUpsert[] {
  return [
    { role: 'buyer', isPrimary: true, party: mapped.parties.buyer },
    { role: 'buyer', isPrimary: false, party: mapped.parties.secondaryBuyer },
    { role: 'seller', isPrimary: true, party: mapped.parties.seller },
    { role: 'seller', isPrimary: false, party: mapped.parties.secondarySeller },
    { role: 'lender', isPrimary: true, party: mapped.parties.lender, contactId: updates.lenderId },
    { role: 'listing_agent', isPrimary: true, party: mapped.parties.listingAgent, contactId: updates.listingAgentId },
    // Mirrors listing_agent, minus the contact FK: there is no
    // orders.buyer_agent_id column to resolve one onto, and SoftPro returned no
    // BuyersAgentBrokers.Person.LookupCode on any of the 7 files that carry an
    // agent, so there is nothing to resolve with either.
    { role: 'buyer_agent', isPrimary: true, party: mapped.parties.buyerAgent },
    { role: 'escrow_company', isPrimary: true, party: mapped.parties.escrowCompany },
    { role: 'lender_contact', isPrimary: true, party: mapped.parties.mortgageBroker },
    { role: 'other', isPrimary: true, party: mapped.parties.titleCompany, companyId: updates.titleCompanyId },
    { role: 'other', isPrimary: false, party: mapped.parties.underwriter, companyId: updates.underwriterId },
  ];
}

async function persistResolvedParties(
  orderId: number,
  mapped: MappedOrderContacts,
  updates: OrderFkUpdates,
): Promise<number> {
  let written = 0;
  for (const row of plannedPartyRows(mapped, updates)) {
    if (!row.party && !row.contactId && !row.companyId) continue;
    if (await upsertResolvedParty(orderId, row)) written++;
  }
  return written;
}

async function upsertResolvedParty(orderId: number, row: PartyUpsert): Promise<boolean> {
  if (!row.party && !row.contactId && !row.companyId) return false;

  const identity = row.party
    ? await resolvePartyIdentityFromMaster(row.party, row.contactId, row.companyId)
    : await (async (): Promise<ResolvedPartyIdentity> => {
      if (row.contactId) return loadContactIdentity(row.contactId);
      if (row.companyId) return loadCompanyIdentity(row.companyId);
      return { name: null, company: null, email: null, phone: null, contactId: null };
    })();

  const externalName = identity.name;
  const externalCompany = identity.company;
  const externalEmail = identity.email;
  const externalPhone = identity.phone;

  if (!externalName && !externalCompany && !externalEmail && !externalPhone) return false;

  const contactId = identity.contactId ?? row.contactId ?? null;

  const [existing] = await db
    .select({ id: orderParties.id })
    .from(orderParties)
    .where(and(
      eq(orderParties.orderId, orderId),
      eq(orderParties.role, row.role),
      eq(orderParties.isPrimary, row.isPrimary),
    ))
    .limit(1);

  const values: Partial<typeof orderParties.$inferInsert> = {
    ...(contactId ? { contactId } : {}),
    ...(externalName ? { externalName } : {}),
    ...(externalCompany ? { externalCompany } : {}),
    ...(externalEmail ? { externalEmail } : {}),
    ...(externalPhone ? { externalPhone } : {}),
  };

  if (existing) {
    await db.update(orderParties).set(values).where(eq(orderParties.id, existing.id));
    return true;
  }

  try {
    await db.insert(orderParties).values({
      orderId,
      role: row.role,
      isPrimary: row.isPrimary,
      contactId: contactId ?? null,
      externalName: externalName ?? null,
      externalCompany: externalCompany ?? null,
      externalEmail: externalEmail ?? null,
      externalPhone: externalPhone ?? null,
    });
  } catch (err) {
    // Migration 0035 put a unique index on (order_id, role, is_primary), so the
    // gap between the SELECT above and this INSERT is no longer a silent
    // duplicate — it RAISES. That gap is reachable: the scheduled batch holds a
    // single-flight lock against itself but not against the manual
    // POST /api/orders/[id]/enrich, and re-enriching 96 orders must not abort
    // part-way because one of them was also enriched by hand at that moment.
    // The lost race means the row now exists, so converge onto it.
    if (!isUniqueViolation(err)) throw err;
    await db.update(orderParties).set(values).where(and(
      eq(orderParties.orderId, orderId),
      eq(orderParties.role, row.role),
      eq(orderParties.isPrimary, row.isPrimary),
    ));
  }

  return true;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null
    && (err as { code?: unknown }).code === '23505';
}
