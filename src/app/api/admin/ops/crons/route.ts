import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { db } from '@/lib/db/client';
import { jobs } from '@/lib/db/schema';
import { sql, gte, and, lt } from 'drizzle-orm';

const ADMIN_ROLES = ['super_admin', 'admin'];

const CRON_SCHEDULES: Record<string, string> = {
  'softpro.sync_recent_orders': 'Hourly :00',
  'softpro.enrich_orders': 'Every 15min',
  'softpro.enrich_order_details': 'Every 15min',
  'softpro.fetch_prelims': 'Every 15min',
  'notifications.process_outbox': 'Every 5min',
  'softpro.verify_sync': 'Daily 6:00 UTC',
  'softpro.sync_new_users': 'Daily 5:00 UTC',
  'softpro.sync_all_contacts': 'Daily 3:00 UTC',
  'import-orders': 'Manual only (date-range timeouts)',
  'jobs.watchdog': 'Every 15min',
  'ops.daily_report': 'Daily 8:00 AM PT',
};

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !ADMIN_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const now = new Date();
    const month = Number(req.nextUrl.searchParams.get('month') || now.getMonth() + 1);
    const year = Number(req.nextUrl.searchParams.get('year') || now.getFullYear());
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 1);

    const rows = await db
      .select({
        jobType: jobs.jobType,
        runs: sql<number>`count(*)::int`,
        completed: sql<number>`count(*) filter (where ${jobs.status} = 'completed')::int`,
        failed: sql<number>`count(*) filter (where ${jobs.status} = 'failed')::int`,
        avgDurationMs: sql<number>`coalesce(avg(extract(epoch from (${jobs.endedAt} - ${jobs.startedAt})) * 1000)::int, 0)`,
        lastRun: sql<string>`max(${jobs.startedAt})`,
        lastStatus: sql<string>`(
          select ${jobs.status} from ${jobs} j2
          where j2.job_type = ${jobs.jobType}
          order by j2.created_at desc limit 1
        )`,
        lastError: sql<string>`(
          select ${jobs.error} from ${jobs} j2
          where j2.job_type = ${jobs.jobType} and j2.status = 'failed'
          order by j2.created_at desc limit 1
        )`,
      })
      .from(jobs)
      .where(and(gte(jobs.createdAt, monthStart), lt(jobs.createdAt, monthEnd)))
      .groupBy(jobs.jobType);

    const crons = rows.map((r) => ({
      jobType: r.jobType,
      schedule: CRON_SCHEDULES[r.jobType] ?? 'Unknown',
      lastRun: r.lastRun ?? null,
      lastStatus: r.lastStatus ?? null,
      lastError: r.lastError ?? null,
      monthly: { runs: r.runs, completed: r.completed, failed: r.failed },
      avgDurationMs: r.avgDurationMs,
    }));

    return NextResponse.json({ crons });
  } catch (err) {
    console.error('[OPS] crons error:', err);
    return NextResponse.json(
      { error: 'Failed to load cron status', detail: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 },
    );
  }
}
