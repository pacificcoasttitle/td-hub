import { sql, type SQL } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { expectsPctEscrowOfficerSql, missingExpectedEscrowOfficerSql } from '@/lib/domain/orders/escrow-officer-expectation';

export type SectionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface DailyReport {
  generatedAt: Date;
  windowStart: Date;
  windowEnd: Date;
  sectionsLoaded: number;
  sectionsFailed: number;
  summary: SummaryData;
  orderFlow: SectionResult<OrderFlowData>;
  syncHealth: SectionResult<SyncHealthData>;
  prelims: SectionResult<PrelimsData>;
  cpls: SectionResult<CplsData>;
  vendorApiHealth: SectionResult<VendorApiHealthData>;
  notifications: SectionResult<NotificationsData>;
  users: SectionResult<UsersData>;
  growth: SectionResult<GrowthData>;
  contactAutoFlagging: SectionResult<ContactAutoFlaggingData>;
  operationsBacklog: SectionResult<OperationsBacklogData>;
  enrichmentCoverage: SectionResult<EnrichmentCoverageData>;
  tessaPrelimAnalysis: SectionResult<TessaPrelimAnalysisData>;
  securityAccess: SectionResult<SecurityAccessData>;
  failuresDetail: SectionResult<FailuresDetailData>;
}

export interface SummaryData {
  status: 'healthy' | 'attention' | 'critical';
  statusEmoji: '🟢' | '🟡' | '🔴';
  totalOrdersSynced: number;
  totalPrelimsAnalyzed: number;
  attentionItems: string[];
}

export interface OrderFlowData {
  syncedFromSoftPro: number;
  createdInTdHub: number;
  enrichedFully: number;
  pendingEnrichmentWithinCooldown: number;
  stuckOver6Hours: number;
  stuckTerminal: number;
  newlyStuckOver6Hours: number;
}

export interface SyncHealthRow {
  jobType: string;
  runs: number;
  succeeded: number;
  failed: number;
  avgDurationSeconds: number;
  lastRun: Date | null;
}

export interface SyncHealthData {
  rows: SyncHealthRow[];
}

export interface PrelimsData {
  fetched: number;
  tessaAnalysesQueued: number;
  tessaAnalysesCompleted: number;
  tessaAnalysesFailed: number;
  approximateClaudeApiCost: number | 'Not tracked';
}

export interface CplVendorCount {
  vendor: string;
  count: number;
}

export interface CplsData {
  generated: CplVendorCount[];
  failedByVendor: CplVendorCount[];
  generatedDocuments: number;
}

export interface VendorApiHealthRow {
  vendor: string;
  calls: number;
  success: number;
  errors: number;
  successRate: number;
  lastFailure: Date | null;
}

export interface VendorApiHealthData {
  rows: VendorApiHealthRow[];
}

export interface NotificationsData {
  attempted: number;
  delivered: number;
  failed: number;
  categories: CplVendorCount[];
  /** Confirmations that sent but lacked the form's client recipient (loud ops signal). */
  confirmationMissingClient: number;
  /** Confirmations that resolved zero recipients (should be rare after openorders CC). */
  confirmationNoRecipients: number;
}

export interface UsersData {
  activeUsers: 'Not tracked';
  newUsersCreated: number;
  roleChanges: 'Not tracked';
  failedLoginAttempts: 'Not tracked';
}

export interface GrowthItem {
  label: string;
  total: number;
  delta: number;
}

export interface GrowthData {
  items: GrowthItem[];
}

export interface ContactAutoFlaggingData {
  newRealEstateAgentFlags: number;
  newStubCompaniesCreated: number;
  multiRoleExpansions: number;
}

export interface OperationsBacklogData {
  ordersMissingAddress: number;
  ordersMissingSalesRep: number;
  ordersMissingEscrowOfficer: number;
  orphanContacts: number;
  stubRealEstateCompanies: number;
}

export interface EnrichmentCoverageData {
  zeroPartyTotal: number;
  zeroPartyUnconfirmed: number;
  emptyConfirmedTotal: number;
  fkOnlyStuck: number;
  ordersWithRealParticipant: number;
  currentBacklogSize: number;
  lastCompletedAt: Date | null;
  minutesSinceLastCompleted: number | null;
  alerts: string[];
}

export interface TessaPrelimAnalysisData {
  autoAnalyzedByCron: number;
  analyzedOnDemand: number;
  totalSuccessfulAnalyses: number;
  totalFailedAnalyses: number;
  backlogFetchedNotAnalyzed: number;
}

export interface SecurityAccessData {
  failedLoginAttempts: 'Not tracked';
  unauthorizedSpikes: 'Not tracked';
  serviceRoleTokenUsage: 'Not tracked';
  roleEscalations: 'Not tracked';
}

export interface FailureDetailRow {
  category: string;
  vendorOrJob: string;
  orderReference: string | null;
  errorSummary: string;
  occurrences: number;
  firstSeen: Date | null;
  lastSeen: Date | null;
  remediationStatus: string;
}

export interface FailuresDetailData {
  rows: FailureDetailRow[];
  distinctCount: number;
  limit: number;
}

const TRACKED_VENDORS = ['softpro', 'titlepoint', 'sitex', 'westcor', 'fnf', 'sendgrid', 'anthropic', 'claude'];
const ZERO_PARTY_UNCONFIRMED_BASELINE = 17;
const FK_ONLY_STUCK_BASELINE = 16;
const ENRICHMENT_BACKLOG_STALL_MINUTES = 30;

async function queryRows<T extends Record<string, unknown>>(statement: SQL<unknown>): Promise<T[]> {
  const rows = await db.execute(statement);
  return rows as unknown as T[];
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value) || 0;
  return 0;
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown';
}

async function runSection<T>(load: () => Promise<T>): Promise<SectionResult<T>> {
  try {
    return { ok: true, data: await load() };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function getOrderFlowSection(windowStart: Date, windowEnd: Date): Promise<SectionResult<OrderFlowData>> {
  return runSection(async () => {
    // Date.toISOString() required: raw sql templates need ISO strings, not Date objects.
    // See: /docs/claude-skills/patterns/drizzle-timestamp-coercion.md
    const expectedEscrowOfficer = expectsPctEscrowOfficerSql(sql.raw('o.order_type'));
    const missingExpectedEscrowOfficer = missingExpectedEscrowOfficerSql(sql.raw('o.order_type'), sql.raw('o.escrow_officer_id'));
    const missingRequiredEnrichment = sql`(
      nullif(coalesce(op.address, op.full_address), '') is null
      or o.sales_rep_id is null
      or (${missingExpectedEscrowOfficer})
    )`;
    const [row] = await queryRows<{
      synced_from_softpro: unknown;
      created_in_td_hub: unknown;
      enriched_fully: unknown;
      pending_enrichment_within_cooldown: unknown;
      stuck_over_6_hours: unknown;
      stuck_terminal: unknown;
      newly_stuck_over_6_hours: unknown;
    }>(sql`
      select
        count(*) filter (where o.source = 'softpro_sync' and o.created_at >= ${windowStart.toISOString()} and o.created_at < ${windowEnd.toISOString()})::int as synced_from_softpro,
        count(*) filter (where o.source in ('manual_entry', 'web_form') and o.created_at >= ${windowStart.toISOString()} and o.created_at < ${windowEnd.toISOString()})::int as created_in_td_hub,
        count(*) filter (
          where o.created_at >= ${windowStart.toISOString()} and o.created_at < ${windowEnd.toISOString()}
            and nullif(coalesce(op.address, op.full_address), '') is not null
            and o.sales_rep_id is not null
            and (not (${expectedEscrowOfficer}) or o.escrow_officer_id is not null)
        )::int as enriched_fully,
        count(*) filter (
          where o.source = 'softpro_sync'
            and o.operational_status in ('open', 'in_process', 'completed')
            and ${missingRequiredEnrichment}
            and o.last_details_fetch_at >= (${windowEnd.toISOString()}::timestamp - interval '6 hours')
        )::int as pending_enrichment_within_cooldown,
        count(*) filter (
          where o.source = 'softpro_sync'
            and o.operational_status in ('open', 'in_process', 'completed')
            and o.created_at < (${windowEnd.toISOString()}::timestamp - interval '6 hours')
            and ${missingRequiredEnrichment}
        )::int as stuck_over_6_hours,
        count(*) filter (
          where o.source = 'softpro_sync'
            and o.operational_status in ('closed', 'canceled', 'duplicate')
            and o.created_at < (${windowEnd.toISOString()}::timestamp - interval '6 hours')
            and ${missingRequiredEnrichment}
        )::int as stuck_terminal,
        count(*) filter (
          where o.source = 'softpro_sync'
            and o.operational_status in ('open', 'in_process', 'completed')
            and o.created_at >= ${windowStart.toISOString()}
            and o.created_at < (${windowEnd.toISOString()}::timestamp - interval '6 hours')
            and ${missingRequiredEnrichment}
        )::int as newly_stuck_over_6_hours
      from orders o
      left join order_properties op on op.order_id = o.id
    `);

    return {
      syncedFromSoftPro: toNumber(row?.synced_from_softpro),
      createdInTdHub: toNumber(row?.created_in_td_hub),
      enrichedFully: toNumber(row?.enriched_fully),
      pendingEnrichmentWithinCooldown: toNumber(row?.pending_enrichment_within_cooldown),
      stuckOver6Hours: toNumber(row?.stuck_over_6_hours),
      stuckTerminal: toNumber(row?.stuck_terminal),
      newlyStuckOver6Hours: toNumber(row?.newly_stuck_over_6_hours),
    };
  });
}

export async function getSyncHealthSection(windowStart: Date, windowEnd: Date): Promise<SectionResult<SyncHealthData>> {
  return runSection(async () => {
    // Date.toISOString() required: raw sql templates need ISO strings, not Date objects.
    // See: /docs/claude-skills/patterns/drizzle-timestamp-coercion.md
    const rows = await queryRows<{
      job_type: string;
      runs: unknown;
      succeeded: unknown;
      failed: unknown;
      avg_duration_seconds: unknown;
      last_run: unknown;
    }>(sql`
      select
        job_type,
        count(*)::int as runs,
        count(*) filter (where status = 'completed')::int as succeeded,
        count(*) filter (where status = 'failed')::int as failed,
        coalesce(avg(extract(epoch from (ended_at - started_at))), 0)::float as avg_duration_seconds,
        max(coalesce(started_at, created_at)) as last_run
      from jobs
      where created_at >= ${windowStart.toISOString()} and created_at < ${windowEnd.toISOString()}
      group by job_type
      order by job_type
    `);

    return {
      rows: rows.map((row) => ({
        jobType: row.job_type,
        runs: toNumber(row.runs),
        succeeded: toNumber(row.succeeded),
        failed: toNumber(row.failed),
        avgDurationSeconds: toNumber(row.avg_duration_seconds),
        lastRun: toDate(row.last_run),
      })),
    };
  });
}

export async function getPrelimsSection(windowStart: Date, windowEnd: Date): Promise<SectionResult<PrelimsData>> {
  return runSection(async () => {
    // Date.toISOString() required: raw sql templates need ISO strings, not Date objects.
    // See: /docs/claude-skills/patterns/drizzle-timestamp-coercion.md
    const [row] = await queryRows<{
      fetched: unknown;
      queued: unknown;
      completed: unknown;
      failed: unknown;
    }>(sql`
      select
        (select count(*)::int from documents where category = 'prelim' and status = 'active' and created_at >= ${windowStart.toISOString()} and created_at < ${windowEnd.toISOString()}) as fetched,
        (select count(*)::int from prelim_analyses where status in ('pending', 'downloading', 'extracting', 'analyzing', 'summarizing') and created_at >= ${windowStart.toISOString()} and created_at < ${windowEnd.toISOString()}) as queued,
        (select count(*)::int from prelim_analyses where status = 'complete' and coalesce(completed_at, updated_at, created_at) >= ${windowStart.toISOString()} and coalesce(completed_at, updated_at, created_at) < ${windowEnd.toISOString()}) as completed,
        (select count(*)::int from prelim_analyses where status = 'failed' and updated_at >= ${windowStart.toISOString()} and updated_at < ${windowEnd.toISOString()}) as failed
    `);

    return {
      fetched: toNumber(row?.fetched),
      tessaAnalysesQueued: toNumber(row?.queued),
      tessaAnalysesCompleted: toNumber(row?.completed),
      tessaAnalysesFailed: toNumber(row?.failed),
      approximateClaudeApiCost: 'Not tracked',
    };
  });
}

export async function getCplsSection(windowStart: Date, windowEnd: Date): Promise<SectionResult<CplsData>> {
  return runSection(async () => {
    // Date.toISOString() required: raw sql templates need ISO strings, not Date objects.
    // See: /docs/claude-skills/patterns/drizzle-timestamp-coercion.md
    const generated = await queryRows<{ vendor: string; count: unknown }>(sql`
      select vendor, count(*)::int as count
      from vendor_api_logs
      where created_at >= ${windowStart.toISOString()} and created_at < ${windowEnd.toISOString()}
        and operation ilike '%cpl%'
        and success = true
      group by vendor
      order by vendor
    `);
    const failedByVendor = await queryRows<{ vendor: string; count: unknown }>(sql`
      select coalesce(nullif(underwriter, ''), 'unknown') as vendor, count(*)::int as count
      from cpl_error_logs
      where created_at >= ${windowStart.toISOString()} and created_at < ${windowEnd.toISOString()}
      group by coalesce(nullif(underwriter, ''), 'unknown')
      order by vendor
    `);
    const [documentsRow] = await queryRows<{ count: unknown }>(sql`
      select count(*)::int as count
      from documents
      where category = 'cpl' and status = 'active' and created_at >= ${windowStart.toISOString()} and created_at < ${windowEnd.toISOString()}
    `);

    return {
      generated: generated.map((row) => ({ vendor: row.vendor, count: toNumber(row.count) })),
      failedByVendor: failedByVendor.map((row) => ({ vendor: row.vendor, count: toNumber(row.count) })),
      generatedDocuments: toNumber(documentsRow?.count),
    };
  });
}

export async function getVendorApiHealthSection(windowStart: Date, windowEnd: Date): Promise<SectionResult<VendorApiHealthData>> {
  return runSection(async () => {
    // Date.toISOString() required: raw sql templates need ISO strings, not Date objects.
    // See: /docs/claude-skills/patterns/drizzle-timestamp-coercion.md
    const rows = await queryRows<{
      vendor: string;
      calls: unknown;
      success_count: unknown;
      error_count: unknown;
      last_failure: unknown;
    }>(sql`
      select
        vendor,
        count(*)::int as calls,
        count(*) filter (where success = true)::int as success_count,
        count(*) filter (where success = false)::int as error_count,
        max(created_at) filter (where success = false) as last_failure
      from vendor_api_logs
      where created_at >= ${windowStart.toISOString()} and created_at < ${windowEnd.toISOString()}
      group by vendor
    `);

    const byVendor = new Map(rows.map((row) => [row.vendor, row]));
    const vendors = Array.from(new Set([...TRACKED_VENDORS, ...rows.map((row) => row.vendor)])).sort();

    return {
      rows: vendors.map((vendor) => {
        const row = byVendor.get(vendor);
        const calls = toNumber(row?.calls);
        const success = toNumber(row?.success_count);
        const errors = toNumber(row?.error_count);
        return {
          vendor,
          calls,
          success,
          errors,
          successRate: calls === 0 ? 100 : Math.round((success / calls) * 1000) / 10,
          lastFailure: toDate(row?.last_failure),
        };
      }),
    };
  });
}

export async function getNotificationsSection(windowStart: Date, windowEnd: Date): Promise<SectionResult<NotificationsData>> {
  return runSection(async () => {
    // Date.toISOString() required: raw sql templates need ISO strings, not Date objects.
    // See: /docs/claude-skills/patterns/drizzle-timestamp-coercion.md
    const [row] = await queryRows<{ attempted: unknown; delivered: unknown; failed: unknown }>(sql`
      select
        count(*)::int as attempted,
        count(*) filter (where status in ('sent', 'delivered', 'success', 'completed', 'sent_no_client'))::int as delivered,
        count(*) filter (where status in ('failed', 'bounced', 'rejected', 'error'))::int as failed
      from notification_logs
      where created_at >= ${windowStart.toISOString()} and created_at < ${windowEnd.toISOString()}
    `);
    const categories = await queryRows<{ vendor: string; count: unknown }>(sql`
      select status as vendor, count(*)::int as count
      from notification_logs
      where created_at >= ${windowStart.toISOString()} and created_at < ${windowEnd.toISOString()}
        and status in ('failed', 'bounced', 'rejected', 'error')
      group by status
      order by status
    `);
    const [confirmationFlags] = await queryRows<{ missing_client: unknown; no_recipients: unknown }>(sql`
      select
        count(*) filter (where email_status = 'sent_no_client')::int as missing_client,
        count(*) filter (where email_status = 'no_recipients')::int as no_recipients
      from orders
      where updated_at >= ${windowStart.toISOString()} and updated_at < ${windowEnd.toISOString()}
        and email_status in ('sent_no_client', 'no_recipients')
    `);

    return {
      attempted: toNumber(row?.attempted),
      delivered: toNumber(row?.delivered),
      failed: toNumber(row?.failed),
      categories: categories.map((category) => ({ vendor: category.vendor, count: toNumber(category.count) })),
      confirmationMissingClient: toNumber(confirmationFlags?.missing_client),
      confirmationNoRecipients: toNumber(confirmationFlags?.no_recipients),
    };
  });
}

export async function getUsersSection(windowStart: Date, windowEnd: Date): Promise<SectionResult<UsersData>> {
  return runSection(async () => {
    // Date.toISOString() required: raw sql templates need ISO strings, not Date objects.
    // See: /docs/claude-skills/patterns/drizzle-timestamp-coercion.md
    const [row] = await queryRows<{ new_users: unknown }>(sql`
      select count(*)::int as new_users
      from profiles
      where created_at >= ${windowStart.toISOString()} and created_at < ${windowEnd.toISOString()}
    `);

    return {
      activeUsers: 'Not tracked',
      newUsersCreated: toNumber(row?.new_users),
      roleChanges: 'Not tracked',
      failedLoginAttempts: 'Not tracked',
    };
  });
}

export async function getGrowthSection(_windowStart: Date, windowEnd: Date): Promise<SectionResult<GrowthData>> {
  return runSection(async () => {
    // Date.toISOString() required: raw sql templates need ISO strings, not Date objects.
    // See: /docs/claude-skills/patterns/drizzle-timestamp-coercion.md
    const sevenDaysAgo = new Date(windowEnd.getTime() - 7 * 24 * 60 * 60 * 1000);
    const [row] = await queryRows<Record<string, unknown>>(sql`
      select
        (select count(*)::int from orders) as orders_total,
        (select count(*)::int from orders where created_at >= ${sevenDaysAgo.toISOString()} and created_at < ${windowEnd.toISOString()}) as orders_delta,
        (select count(*)::int from contacts where is_real_estate_agent = true) as agents_total,
        (select count(*)::int from contacts where is_real_estate_agent = true and created_at >= ${sevenDaysAgo.toISOString()} and created_at < ${windowEnd.toISOString()}) as agents_delta,
        (select count(*)::int from companies where is_real_estate_company = true) as re_companies_total,
        (select count(*)::int from companies where is_real_estate_company = true and created_at >= ${sevenDaysAgo.toISOString()} and created_at < ${windowEnd.toISOString()}) as re_companies_delta,
        (select count(*)::int from contacts where is_escrow_officer = true and source_system = 'softpro') as external_eo_total,
        (select count(*)::int from contacts where is_escrow_officer = true and source_system = 'softpro' and created_at >= ${sevenDaysAgo.toISOString()} and created_at < ${windowEnd.toISOString()}) as external_eo_delta,
        (select count(*)::int from companies) as companies_total,
        (select count(*)::int from companies where created_at >= ${sevenDaysAgo.toISOString()} and created_at < ${windowEnd.toISOString()}) as companies_delta
    `);

    return {
      items: [
        { label: 'Total orders', total: toNumber(row?.orders_total), delta: toNumber(row?.orders_delta) },
        { label: 'Total real estate agents', total: toNumber(row?.agents_total), delta: toNumber(row?.agents_delta) },
        { label: 'Total real estate companies', total: toNumber(row?.re_companies_total), delta: toNumber(row?.re_companies_delta) },
        { label: 'Total escrow officers external', total: toNumber(row?.external_eo_total), delta: toNumber(row?.external_eo_delta) },
        { label: 'Total companies overall', total: toNumber(row?.companies_total), delta: toNumber(row?.companies_delta) },
      ],
    };
  });
}

export async function getContactAutoFlaggingSection(windowStart: Date, windowEnd: Date): Promise<SectionResult<ContactAutoFlaggingData>> {
  return runSection(async () => {
    // Date.toISOString() required: raw sql templates need ISO strings, not Date objects.
    // See: /docs/claude-skills/patterns/drizzle-timestamp-coercion.md
    const [row] = await queryRows<Record<string, unknown>>(sql`
      select
        (select count(*)::int from contacts where is_real_estate_agent = true and updated_at >= ${windowStart.toISOString()} and updated_at < ${windowEnd.toISOString()}) as agent_flags,
        (select count(*)::int from companies where name = lookup_code and created_at >= ${windowStart.toISOString()} and created_at < ${windowEnd.toISOString()}) as stub_companies,
        (select count(*)::int from contacts
          where updated_at >= ${windowStart.toISOString()} and updated_at < ${windowEnd.toISOString()}
            and is_real_estate_agent = true
            and (is_escrow_officer = true or is_lender = true or is_mortgage_broker = true or is_title_officer = true or is_sales_rep = true)
        ) as multi_role_expansions
    `);

    return {
      newRealEstateAgentFlags: toNumber(row?.agent_flags),
      newStubCompaniesCreated: toNumber(row?.stub_companies),
      multiRoleExpansions: toNumber(row?.multi_role_expansions),
    };
  });
}

export async function getOperationsBacklogSection(_windowStart: Date, _windowEnd: Date): Promise<SectionResult<OperationsBacklogData>> {
  return runSection(async () => {
    const missingExpectedEscrowOfficer = missingExpectedEscrowOfficerSql(sql.raw('orders.order_type'), sql.raw('orders.escrow_officer_id'));
    const [row] = await queryRows<Record<string, unknown>>(sql`
      select
        (select count(*)::int from orders o left join order_properties op on op.order_id = o.id where nullif(coalesce(op.address, op.full_address), '') is null) as missing_address,
        (select count(*)::int from orders where sales_rep_id is null) as missing_sales_rep,
        (select count(*)::int from orders where ${missingExpectedEscrowOfficer}) as missing_escrow_officer,
        (select count(*)::int from contacts c left join companies co on c.flookup_code = co.lookup_code where c.flookup_code is not null and co.id is null) as orphan_contacts,
        (select count(*)::int from companies where is_real_estate_company = true and name = lookup_code) as stub_re_companies
    `);

    return {
      ordersMissingAddress: toNumber(row?.missing_address),
      ordersMissingSalesRep: toNumber(row?.missing_sales_rep),
      ordersMissingEscrowOfficer: toNumber(row?.missing_escrow_officer),
      orphanContacts: toNumber(row?.orphan_contacts),
      stubRealEstateCompanies: toNumber(row?.stub_re_companies),
    };
  });
}

export function evaluateEnrichmentCoverageAlerts(data: Omit<EnrichmentCoverageData, 'alerts'>): string[] {
  const alerts: string[] = [];

  if (data.zeroPartyUnconfirmed > ZERO_PARTY_UNCONFIRMED_BASELINE) {
    alerts.push(`Zero-party unconfirmed orders rose above baseline: ${data.zeroPartyUnconfirmed} > ${ZERO_PARTY_UNCONFIRMED_BASELINE}.`);
  }

  if (data.fkOnlyStuck > FK_ONLY_STUCK_BASELINE) {
    alerts.push(`FK-only stuck orders grew above baseline: ${data.fkOnlyStuck} > ${FK_ONLY_STUCK_BASELINE}.`);
  }

  if (data.currentBacklogSize > 0 && data.minutesSinceLastCompleted === null) {
    alerts.push(`Enrichment backlog is ${data.currentBacklogSize}, but no completed enrich_orders run was found.`);
  } else if (
    data.currentBacklogSize > 0
    && data.minutesSinceLastCompleted !== null
    && data.minutesSinceLastCompleted > ENRICHMENT_BACKLOG_STALL_MINUTES
  ) {
    alerts.push(`Enrichment backlog may be stalled: ${data.currentBacklogSize} orders pending, last completed run ${data.minutesSinceLastCompleted} min ago.`);
  }

  return alerts;
}

export async function getEnrichmentCoverageSection(): Promise<SectionResult<EnrichmentCoverageData>> {
  return runSection(async () => {
    const [row] = await queryRows<Record<string, unknown>>(sql`
      with eligible_orders as (
        select *
        from orders
        where operational_status not in ('canceled', 'duplicate')
      ),
      order_party_counts as (
        select
          order_id,
          count(*)::int as party_count,
          count(*) filter (
            where role in ('buyer', 'seller', 'lender', 'lender_contact', 'listing_agent')
          )::int as real_participant_count
        from order_parties
        group by order_id
      ),
      current_backlog as (
        select count(*)::int as count
        from orders o
        where coalesce(o.contacts_empty_confirmed, false) = false
          and (
            not exists (select 1 from order_parties op where op.order_id = o.id)
            or o.client_contact_id is null
          )
      ),
      last_completed_enrich as (
        select coalesce(ended_at, started_at, created_at) as completed_at
        from jobs
        where job_type in ('softpro.enrich_orders', 'enrich-orders')
          and status = 'completed'
        order by coalesce(ended_at, started_at, created_at) desc
        limit 1
      )
      select
        count(*) filter (where coalesce(opc.party_count, 0) = 0)::int as zero_party_total,
        count(*) filter (
          where coalesce(opc.party_count, 0) = 0
            and coalesce(eo.contacts_empty_confirmed, false) = false
        )::int as zero_party_unconfirmed,
        count(*) filter (where coalesce(eo.contacts_empty_confirmed, false) = true)::int as empty_confirmed_total,
        count(*) filter (
          where coalesce(opc.party_count, 0) = 0
            and coalesce(eo.contacts_empty_confirmed, false) = false
            and (
              eo.lender_id is not null
              or eo.listing_agent_id is not null
              or eo.title_company_id is not null
              or eo.underwriter_id is not null
              or eo.client_contact_id is not null
            )
        )::int as fk_only_stuck,
        count(*) filter (where coalesce(opc.real_participant_count, 0) > 0)::int as orders_with_real_participant,
        (select count from current_backlog)::int as current_backlog_size,
        (select completed_at from last_completed_enrich) as last_completed_at
      from eligible_orders eo
      left join order_party_counts opc on opc.order_id = eo.id
    `);
    const lastCompletedAt = toDate(row?.last_completed_at);
    const minutesSinceLastCompleted = lastCompletedAt
      ? Math.floor((Date.now() - lastCompletedAt.getTime()) / 60_000)
      : null;

    const data = {
      zeroPartyTotal: toNumber(row?.zero_party_total),
      zeroPartyUnconfirmed: toNumber(row?.zero_party_unconfirmed),
      emptyConfirmedTotal: toNumber(row?.empty_confirmed_total),
      fkOnlyStuck: toNumber(row?.fk_only_stuck),
      ordersWithRealParticipant: toNumber(row?.orders_with_real_participant),
      currentBacklogSize: toNumber(row?.current_backlog_size),
      lastCompletedAt,
      minutesSinceLastCompleted,
    };

    return {
      ...data,
      alerts: evaluateEnrichmentCoverageAlerts(data),
    };
  });
}

export async function getTessaPrelimAnalysisSection(windowStart: Date, windowEnd: Date): Promise<SectionResult<TessaPrelimAnalysisData>> {
  return runSection(async () => {
    // Date.toISOString() required: raw sql templates need ISO strings, not Date objects.
    // See: /docs/claude-skills/patterns/drizzle-timestamp-coercion.md
    const [row] = await queryRows<Record<string, unknown>>(sql`
      select
        (select count(*)::int from prelim_analyses where triggered_by = 'cron' and created_at >= ${windowStart.toISOString()} and created_at < ${windowEnd.toISOString()}) as cron_count,
        (select count(*)::int from prelim_analyses where triggered_by = 'manual' and created_at >= ${windowStart.toISOString()} and created_at < ${windowEnd.toISOString()}) as manual_count,
        (select count(*)::int from prelim_analyses where status = 'complete' and coalesce(completed_at, updated_at, created_at) >= ${windowStart.toISOString()} and coalesce(completed_at, updated_at, created_at) < ${windowEnd.toISOString()}) as success_count,
        (select count(*)::int from prelim_analyses where status = 'failed' and updated_at >= ${windowStart.toISOString()} and updated_at < ${windowEnd.toISOString()}) as failed_count,
        (select count(*)::int from documents d
          where d.category = 'prelim' and d.status = 'active'
            and not exists (
              select 1 from prelim_analyses pa
              where pa.document_id = d.id and pa.status = 'complete'
            )
        ) as backlog_count
    `);

    return {
      autoAnalyzedByCron: toNumber(row?.cron_count),
      analyzedOnDemand: toNumber(row?.manual_count),
      totalSuccessfulAnalyses: toNumber(row?.success_count),
      totalFailedAnalyses: toNumber(row?.failed_count),
      backlogFetchedNotAnalyzed: toNumber(row?.backlog_count),
    };
  });
}

export async function getSecurityAccessSection(_windowStart: Date, _windowEnd: Date): Promise<SectionResult<SecurityAccessData>> {
  return runSection(async () => ({
    failedLoginAttempts: 'Not tracked',
    unauthorizedSpikes: 'Not tracked',
    serviceRoleTokenUsage: 'Not tracked',
    roleEscalations: 'Not tracked',
  }));
}

export async function getFailuresDetailSection(windowStart: Date, windowEnd: Date): Promise<SectionResult<FailuresDetailData>> {
  return runSection(async () => {
    // Date.toISOString() required: raw sql templates need ISO strings, not Date objects.
    // See: /docs/claude-skills/patterns/drizzle-timestamp-coercion.md
    const rows = await queryRows<Record<string, unknown>>(sql`
      with raw_failures as (
        select created_at as failure_timestamp, 'Vendor' as category, vendor as vendor_or_job, order_id::text as order_reference,
          left(coalesce(error_category, response_meta->>'error', response_meta->>'body', 'Vendor call failed'), 100) as error_summary,
          case when retryable then 'auto-retried' else 'pending' end as remediation_status
        from vendor_api_logs
        where created_at >= ${windowStart.toISOString()} and created_at < ${windowEnd.toISOString()} and success = false
        union all
        select created_at as failure_timestamp, 'Cron' as category, job_type as vendor_or_job, order_id::text as order_reference,
          left(coalesce(error, 'Job failed'), 100) as error_summary,
          'manual intervention needed' as remediation_status
        from jobs
        where created_at >= ${windowStart.toISOString()} and created_at < ${windowEnd.toISOString()} and status = 'failed'
        union all
        select created_at as failure_timestamp, 'Notification' as category, coalesce(provider, event_type) as vendor_or_job, order_id::text as order_reference,
          left(coalesce(error_message, status), 100) as error_summary,
          'pending' as remediation_status
        from notification_logs
        where created_at >= ${windowStart.toISOString()} and created_at < ${windowEnd.toISOString()} and status in ('failed', 'bounced', 'rejected', 'error')
        union all
        select updated_at as failure_timestamp, 'TESSA' as category, coalesce(error_step, 'analysis') as vendor_or_job, order_id::text as order_reference,
          left(coalesce(error_message, 'TESSA analysis failed'), 100) as error_summary,
          case when error_type = 'max_attempts_reached' then 'manual intervention needed' else 'pending' end as remediation_status
        from prelim_analyses
        where updated_at >= ${windowStart.toISOString()} and updated_at < ${windowEnd.toISOString()} and status = 'failed'
      ),
      grouped_failures as (
        select
          category,
          vendor_or_job,
          order_reference,
          error_summary,
          count(*)::int as occurrences,
          min(failure_timestamp) as first_seen,
          max(failure_timestamp) as last_seen,
          max(remediation_status) as remediation_status
        from raw_failures
        GROUP BY category, vendor_or_job, order_reference, error_summary
      )
      select *, (select count(*)::int from grouped_failures) as distinct_count
      from grouped_failures
      order by occurrences desc, last_seen desc
      limit 30
    `);

    return {
      distinctCount: toNumber(rows[0]?.distinct_count),
      limit: 30,
      rows: rows.map((row) => ({
        category: String(row.category ?? 'Other'),
        vendorOrJob: String(row.vendor_or_job ?? 'unknown'),
        orderReference: row.order_reference ? String(row.order_reference) : null,
        errorSummary: String(row.error_summary ?? 'Unknown failure'),
        occurrences: toNumber(row.occurrences),
        firstSeen: toDate(row.first_seen),
        lastSeen: toDate(row.last_seen),
        remediationStatus: String(row.remediation_status ?? 'pending'),
      })),
    };
  });
}

export async function buildDailyReport(): Promise<DailyReport> {
  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - 24 * 60 * 60 * 1000);

  const [
    orderFlow,
    syncHealth,
    prelims,
    cpls,
    vendorApiHealth,
    notifications,
    users,
    growth,
    contactAutoFlagging,
    operationsBacklog,
    enrichmentCoverage,
    tessaPrelimAnalysis,
    securityAccess,
    failuresDetail,
  ] = await Promise.all([
    getOrderFlowSection(windowStart, windowEnd),
    getSyncHealthSection(windowStart, windowEnd),
    getPrelimsSection(windowStart, windowEnd),
    getCplsSection(windowStart, windowEnd),
    getVendorApiHealthSection(windowStart, windowEnd),
    getNotificationsSection(windowStart, windowEnd),
    getUsersSection(windowStart, windowEnd),
    getGrowthSection(windowStart, windowEnd),
    getContactAutoFlaggingSection(windowStart, windowEnd),
    getOperationsBacklogSection(windowStart, windowEnd),
    getEnrichmentCoverageSection(),
    getTessaPrelimAnalysisSection(windowStart, windowEnd),
    getSecurityAccessSection(windowStart, windowEnd),
    getFailuresDetailSection(windowStart, windowEnd),
  ]);

  const sections = [
    orderFlow, syncHealth, prelims, cpls, vendorApiHealth, notifications, users, growth,
    contactAutoFlagging, operationsBacklog, enrichmentCoverage, tessaPrelimAnalysis, securityAccess, failuresDetail,
  ];

  return {
    generatedAt: new Date(),
    windowStart,
    windowEnd,
    sectionsLoaded: sections.filter((section) => section.ok).length,
    sectionsFailed: sections.filter((section) => !section.ok).length,
    summary: computeSummary({
      orderFlow,
      syncHealth,
      prelims,
      vendorApiHealth,
      notifications,
      enrichmentCoverage,
      sections,
    }),
    orderFlow,
    syncHealth,
    prelims,
    cpls,
    vendorApiHealth,
    notifications,
    users,
    growth,
    contactAutoFlagging,
    operationsBacklog,
    enrichmentCoverage,
    tessaPrelimAnalysis,
    securityAccess,
    failuresDetail,
  };
}

function computeSummary(input: {
  orderFlow: SectionResult<OrderFlowData>;
  syncHealth: SectionResult<SyncHealthData>;
  prelims: SectionResult<PrelimsData>;
  vendorApiHealth: SectionResult<VendorApiHealthData>;
  notifications: SectionResult<NotificationsData>;
  enrichmentCoverage: SectionResult<EnrichmentCoverageData>;
  sections: SectionResult<unknown>[];
}): SummaryData {
  const attentionItems: string[] = [];
  let critical = false;
  let attention = false;

  if (input.syncHealth.ok) {
    const failedJobs = input.syncHealth.data.rows.filter((row) => row.failed > 0);
    if (failedJobs.length >= 3) {
      critical = true;
      attentionItems.push(`Cron failures in last 24h: ${failedJobs.map((row) => `${row.jobType} (${row.failed})`).join(', ')}`);
    } else if (failedJobs.length > 0) {
      attention = true;
      attentionItems.push(`Cron failures in last 24h: ${failedJobs.map((row) => `${row.jobType} (${row.failed})`).join(', ')}`);
    }
  }

  let aggregateRate = 100;
  if (input.vendorApiHealth.ok) {
    const totalCalls = input.vendorApiHealth.data.rows.reduce((sum, row) => sum + row.calls, 0);
    const totalSuccess = input.vendorApiHealth.data.rows.reduce((sum, row) => sum + row.success, 0);
    aggregateRate = totalCalls === 0 ? 100 : (totalSuccess / totalCalls) * 100;
    if (aggregateRate < 80) {
      critical = true;
      attentionItems.push(`Vendor API success rate is ${aggregateRate.toFixed(1)}%.`);
    } else if (aggregateRate < 95) {
      attention = true;
      attentionItems.push(`Vendor API success rate is ${aggregateRate.toFixed(1)}%.`);
    }
  }

  if (input.notifications.ok) {
    if (input.notifications.data.attempted >= 10 && input.notifications.data.delivered === 0) {
      critical = true;
      attentionItems.push(`Notification delivery stopped: ${input.notifications.data.attempted} attempted, 0 delivered.`);
    }
    if (input.notifications.data.confirmationMissingClient > 0) {
      attention = true;
      attentionItems.push(
        `${input.notifications.data.confirmationMissingClient} open-order confirmation(s) sent without a client recipient (openorders@pct.com only).`,
      );
    }
    if (input.notifications.data.confirmationNoRecipients > 0) {
      attention = true;
      attentionItems.push(
        `${input.notifications.data.confirmationNoRecipients} open-order confirmation(s) ended with no_recipients — check recipient resolver.`,
      );
    }
  }

  if (input.orderFlow.ok && input.orderFlow.data.newlyStuckOver6Hours > 50) {
    attention = true;
    attentionItems.push(`${input.orderFlow.data.newlyStuckOver6Hours} orders synced in the last 24h are now >6h old and still missing required enrichment.`);
  }

  if (input.enrichmentCoverage.ok && input.enrichmentCoverage.data.alerts.length > 0) {
    attention = true;
    attentionItems.push(...input.enrichmentCoverage.data.alerts);
  }

  const failedSections = input.sections.filter((section) => !section.ok).length;
  if (failedSections > 0) {
    attention = true;
    attentionItems.push(`${failedSections} report section${failedSections === 1 ? '' : 's'} could not load.`);
  }

  const status = critical ? 'critical' : attention ? 'attention' : 'healthy';
  const totalOrdersSynced = input.orderFlow.ok ? input.orderFlow.data.syncedFromSoftPro : 0;
  const totalPrelimsAnalyzed = input.prelims.ok ? input.prelims.data.tessaAnalysesCompleted : 0;

  return {
    status,
    statusEmoji: status === 'critical' ? '🔴' : status === 'attention' ? '🟡' : '🟢',
    totalOrdersSynced,
    totalPrelimsAnalyzed,
    attentionItems: attentionItems.length > 0 ? attentionItems : ['Nothing requires attention'],
  };
}
