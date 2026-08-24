import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';

// ─── Self-metering ───────────────────────────────────────────────────────────
//
// WHY WE COUNT OURSELVES.
//
// Production's /search/credits returns 2147483647 — INT32_MAX, a sentinel, not
// a balance. On UAT the same endpoint decremented cleanly (292 -> 291 per call),
// which is how the one-credit-per-call cost was measured. In production it does
// not move, so SiteX gives us NO spending signal whatsoever.
//
// That makes concierge_profiles the only record of what we spent. Two uses:
//   - cost control: someone can see the run rate before an invoice arrives
//   - reconciliation: sitex_search_id ties each charge to a specific report
//
// Only SUCCESSFUL vendor calls are counted as spend. A guard failure that never
// reached SiteX costs nothing; a 4xx from SiteX costs nothing (measured). The
// figure below therefore comes from sitex_credits_charged, not from row counts,
// so a retried generation cannot inflate it.

export interface ConciergeUsageMonth {
  month: string;
  profiles: number;
  generated: number;
  failed: number;
  creditsCharged: number;
}

export interface ConciergeUsage {
  total: {
    profiles: number;
    generated: number;
    failed: number;
    creditsCharged: number;
    firstAt: string | null;
    lastAt: string | null;
  };
  byMonth: ConciergeUsageMonth[];
  /** Reports whose vendor call succeeded but which never produced a PDF. */
  chargedWithoutDocument: number;
}

export async function getConciergeUsage(months = 12): Promise<ConciergeUsage> {
  const totalRows = await db.execute(sql`
    select
      count(*)::int                                                  as profiles,
      count(*) filter (where status = 'generated')::int              as generated,
      count(*) filter (where status = 'failed')::int                 as failed,
      coalesce(sum(sitex_credits_charged), 0)::int                   as credits_charged,
      min(created_at)                                                as first_at,
      max(created_at)                                                as last_at,
      count(*) filter (where sitex_credits_charged > 0
                         and status <> 'generated')::int             as charged_without_document
    from concierge_profiles`);

  const t = (totalRows as unknown as Array<Record<string, unknown>>)[0] ?? {};

  const monthRows = await db.execute(sql`
    select
      to_char(date_trunc('month', created_at), 'YYYY-MM')            as month,
      count(*)::int                                                  as profiles,
      count(*) filter (where status = 'generated')::int              as generated,
      count(*) filter (where status = 'failed')::int                 as failed,
      coalesce(sum(sitex_credits_charged), 0)::int                   as credits_charged
    from concierge_profiles
    where created_at >= date_trunc('month', now()) - (${months - 1} * interval '1 month')
    group by 1
    order by 1 desc`);

  const byMonth = (monthRows as unknown as Array<Record<string, unknown>>).map((r) => ({
    month: String(r.month),
    profiles: Number(r.profiles ?? 0),
    generated: Number(r.generated ?? 0),
    failed: Number(r.failed ?? 0),
    creditsCharged: Number(r.credits_charged ?? 0),
  }));

  return {
    total: {
      profiles: Number(t.profiles ?? 0),
      generated: Number(t.generated ?? 0),
      failed: Number(t.failed ?? 0),
      creditsCharged: Number(t.credits_charged ?? 0),
      firstAt: t.first_at ? new Date(t.first_at as string).toISOString() : null,
      lastAt: t.last_at ? new Date(t.last_at as string).toISOString() : null,
    },
    byMonth,
    chargedWithoutDocument: Number(t.charged_without_document ?? 0),
  };
}
