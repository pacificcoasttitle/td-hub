import { NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { db } from '@/lib/db/client';
import { sql } from 'drizzle-orm';
import { classifyVendorStatus } from '@/lib/domain/ops/vendor-health';
import { friendlyJobName } from '@/lib/domain/ops/daily-summary';

const ADMIN_ROLES = ['super_admin', 'admin'];

/**
 * Read-only aggregate for the operations page headline and the watchdog
 * section. Nothing here changes how jobs run or how anything is logged.
 */
export async function GET() {
  const session = await getSession();
  if (!session || !ADMIN_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const [jobRows, vendorRows, watchdog24h, watchdog7d] = await Promise.all([
      db.execute(sql`
        select job_type, count(*) filter (where status = 'failed')::int as failed
        from jobs
        where created_at > now() - interval '24 hours'
        group by job_type
        having count(*) filter (where status = 'failed') > 0
      `) as unknown as Promise<Array<{ job_type: string; failed: number }>>,

      db.execute(sql`
        select vendor,
               count(*)::int as total,
               count(*) filter (where success = true)::int as success
        from vendor_api_logs
        where created_at > now() - interval '24 hours'
        group by vendor
      `) as unknown as Promise<Array<{ vendor: string; total: number; success: number }>>,

      db.execute(sql`
        select job_type, count(*)::int as kills
        from jobs
        where error ilike '%watchdog%' and created_at > now() - interval '24 hours'
        group by job_type order by 2 desc
      `) as unknown as Promise<Array<{ job_type: string; kills: number }>>,

      db.execute(sql`
        select job_type, count(*)::int as kills,
               to_char(max(created_at), 'Mon DD HH24:MI') as last_kill
        from jobs
        where error ilike '%watchdog%' and created_at > now() - interval '7 days'
        group by job_type order by 2 desc
      `) as unknown as Promise<Array<{ job_type: string; kills: number; last_kill: string }>>,
    ]);

    const failingVendors = vendorRows
      .map((v) => ({ vendor: v.vendor, status: classifyVendorStatus({ total: v.total, success: v.success }) }))
      .filter((v) => v.status === 'critical' || v.status === 'degraded');

    const attention: string[] = [];

    const totalJobFailures = jobRows.reduce((s, r) => s + Number(r.failed), 0);
    if (totalJobFailures > 0) {
      const named = jobRows
        .sort((a, b) => Number(b.failed) - Number(a.failed))
        .slice(0, 3)
        .map((r) => `${friendlyJobName(r.job_type)} (${r.failed})`);
      attention.push(
        `${totalJobFailures} background job run${totalJobFailures === 1 ? '' : 's'} failed in the last 24 hours: ${named.join(', ')}`,
      );
    }

    for (const v of failingVendors) {
      attention.push(`${v.vendor} is ${v.status === 'critical' ? 'failing' : 'degraded'}`);
    }

    const kills24h = watchdog24h.reduce((s, r) => s + Number(r.kills), 0);
    if (kills24h > 0) {
      attention.push(
        `${kills24h} job run${kills24h === 1 ? '' : 's'} had to be stopped after hanging: `
        + watchdog24h.map((r) => `${friendlyJobName(r.job_type)} (${r.kills})`).join(', '),
      );
    }

    return NextResponse.json({
      attention,
      watchdog: {
        last24h: kills24h,
        byJob7d: watchdog7d.map((r) => ({
          jobType: r.job_type,
          label: friendlyJobName(r.job_type),
          kills: Number(r.kills),
          lastKill: r.last_kill,
        })),
      },
    });
  } catch (err) {
    console.error('[OPS] summary error:', err);
    return NextResponse.json(
      { error: 'Failed to load summary', detail: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 },
    );
  }
}
