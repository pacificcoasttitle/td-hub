/**
 * The Reports list: one page over four report types.
 *
 * ─── WHY THE UNION IS THE SAME COLUMNS FROM EVERY TABLE ─────────────────────
 *
 * Subject and Settings are STORED as text on each report row (migration 0058),
 * not derived per type. So this query selects the same shape from each table and
 * unions it; a fifth report type is a migration plus one branch here, and there
 * is no type-to-column mapping for readers to keep in step.
 *
 * ─── THE DELIVERY CELL READS THE LOG ────────────────────────────────────────
 *
 * The latest attempt per report comes from report_deliveries, joined here so the
 * cell needs no second fetch. There is deliberately no `sent` boolean on any
 * report row: a flag and a log disagree eventually, and then neither is trusted.
 * A report with no attempt has `delivery: null`, which the page must render as
 * "never sent" rather than as anything resembling success.
 *
 * ─── WHY THE FILTER IS ALL / FARMING / CONCIERGE ────────────────────────────
 *
 * Active / Inactive is meaningless for a report. Farming is the three dataset
 * reports; Concierge is the one found by address and the only one that spends.
 */
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  REPORTS_PAGE_SIZE, REPORT_TYPE_LABELS, sourceLineFor,
  type ReportFilter, type ReportListResult, type ReportListRow, type ReportType,
} from './list-types';

// Re-exported so server callers keep one import. The browser must import
// './list-types' directly — this module reaches the database.
export * from './list-types';

interface RawRow {
  type: string;
  id: number;
  status: string;
  credits_charged: number | null;
  list_subject: string | null;
  list_subject_detail: string | null;
  list_settings: string | null;
  branded_to_name: string | null;
  created_at: string;
  created_by: string | null;
  delivery_outcome: string | null;
  delivery_attempted_at: string | null;
  delivery_recipient_name: string | null;
  delivery_recipient_email: string | null;
}

/**
 * One SELECT per table, unioned. Each contributes the same columns; the two that
 * differ — who the report is branded to, and whether a credit was spent — are
 * mapped here rather than left to the reader.
 */
function unionSql(filter: ReportFilter, search: string | null) {
  const like = search ? `%${search.toLowerCase()}%` : null;
  const matches = (subject: string, settings: string, branded: string) => (like === null
    ? sql`true`
    : sql`(lower(coalesce(${sql.raw(subject)}, '')) like ${like}
        or lower(coalesce(${sql.raw(settings)}, '')) like ${like}
        or lower(coalesce(${sql.raw(branded)}, '')) like ${like})`);

  const parts = [];
  if (filter !== 'concierge') {
    parts.push(sql`
      select 'sales_activity' as type, r.id, r.status, null::int as credits_charged,
             r.list_subject, r.list_subject_detail, r.list_settings,
             coalesce(c.full_name, r.branded_to_name) as branded_to_name,
             r.created_at, r.created_by
        from sales_activity_reports r
        left join contacts c on c.id = r.branded_to_contact_id
       where ${matches('r.list_subject', 'r.list_settings', 'coalesce(c.full_name, r.branded_to_name)')}`);
    parts.push(sql`
      select 'carrier_route' as type, r.id, r.status, null::int as credits_charged,
             r.list_subject, r.list_subject_detail, r.list_settings,
             coalesce(c.full_name, r.branded_to_name) as branded_to_name,
             r.created_at, r.created_by
        from carrier_route_reports r
        left join contacts c on c.id = r.branded_to_contact_id
       where ${matches('r.list_subject', 'r.list_settings', 'coalesce(c.full_name, r.branded_to_name)')}`);
    parts.push(sql`
      select 'county_sales' as type, r.id, r.status, null::int as credits_charged,
             r.list_subject, r.list_subject_detail, r.list_settings,
             coalesce(c.full_name, r.branded_to_name) as branded_to_name,
             r.created_at, r.created_by
        from county_sales_reports r
        left join contacts c on c.id = r.branded_to_contact_id
       where ${matches('r.list_subject', 'r.list_settings', 'coalesce(c.full_name, r.branded_to_name)')}`);
  }
  if (filter !== 'farming') {
    parts.push(sql`
      select 'concierge_profile' as type, r.id, r.status, r.sitex_credits_charged as credits_charged,
             r.list_subject, r.list_subject_detail, r.list_settings,
             r.presenting_rep_name as branded_to_name,
             r.created_at, r.created_by
        from concierge_profiles r
       where ${matches('r.list_subject', 'r.list_settings', 'r.presenting_rep_name')}`);
  }
  return sql.join(parts, sql` union all `);
}

export async function listReports(input: {
  page?: number;
  pageSize?: number;
  filter?: ReportFilter;
  search?: string | null;
} = {}): Promise<ReportListResult> {
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(input.pageSize ?? REPORTS_PAGE_SIZE)));
  const filter = input.filter ?? 'all';
  const search = (input.search ?? '').trim().toLowerCase() || null;
  const union = unionSql(filter, search);

  const [countRow] = await db.execute(sql`select count(*)::int as n from (${union}) all_reports`) as unknown as Array<{ n: number }>;

  const rows = await db.execute(sql`
    select r.*,
           d.outcome        as delivery_outcome,
           d.attempted_at::text as delivery_attempted_at,
           d.recipient_name as delivery_recipient_name,
           d.recipient_email as delivery_recipient_email
      from (${union}) r
      left join lateral (
        select outcome, attempted_at, recipient_name, recipient_email
          from report_deliveries dl
         where dl.report_type = r.type and dl.report_id = r.id
         order by dl.attempted_at desc
         limit 1
      ) d on true
     order by r.created_at desc, r.id desc
     limit ${pageSize} offset ${(page - 1) * pageSize}
  `) as unknown as RawRow[];

  return {
    rows: rows.map((r) => ({
      type: r.type as ReportType,
      id: r.id,
      typeLabel: REPORT_TYPE_LABELS[r.type as ReportType] ?? r.type,
      sourceLine: sourceLineFor(r.type as ReportType, r.status, r.credits_charged),
      subject: r.list_subject,
      subjectDetail: r.list_subject_detail,
      settings: r.list_settings,
      brandedToName: r.branded_to_name,
      status: r.status,
      createdAt: String(r.created_at),
      createdBy: r.created_by,
      delivery: r.delivery_outcome
        ? {
          outcome: r.delivery_outcome === 'delivered' ? 'delivered' : 'failed',
          attemptedAt: String(r.delivery_attempted_at),
          recipientName: r.delivery_recipient_name,
          recipientEmail: String(r.delivery_recipient_email),
        }
        : null,
    })),
    total: countRow?.n ?? 0,
    page,
    pageSize,
  };
}
