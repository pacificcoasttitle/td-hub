import { NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { db } from '@/lib/db/client';
import { vendorApiLogs } from '@/lib/db/schema';
import { sql, gte } from 'drizzle-orm';

const ADMIN_ROLES = ['super_admin', 'admin'];

export async function GET() {
  const session = await getSession();
  if (!session || !ADMIN_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const rows = await db
      .select({
        vendor: vendorApiLogs.vendor,
        total: sql<number>`count(*)::int`,
        success: sql<number>`count(*) filter (where ${vendorApiLogs.success} = true)::int`,
        failed: sql<number>`count(*) filter (where ${vendorApiLogs.success} = false or ${vendorApiLogs.success} is null)::int`,
        avgMs: sql<number>`coalesce(avg(extract(epoch from (${vendorApiLogs.endedAt} - ${vendorApiLogs.startedAt})) * 1000)::int, 0)`,
        lastSuccess: sql<string>`max(case when ${vendorApiLogs.success} = true then ${vendorApiLogs.createdAt} end)`,
        lastFailure: sql<string>`max(case when ${vendorApiLogs.success} = false or ${vendorApiLogs.success} is null then ${vendorApiLogs.createdAt} end)`,
        lastError: sql<string>`(
          select ${vendorApiLogs.errorCategory}
          from ${vendorApiLogs} v2
          where v2.vendor = ${vendorApiLogs.vendor}
            and (v2.success = false or v2.success is null)
          order by v2.created_at desc limit 1
        )`,
      })
      .from(vendorApiLogs)
      .where(gte(vendorApiLogs.createdAt, cutoff))
      .groupBy(vendorApiLogs.vendor);

    const vendors = rows.map((r) => {
      const pct = r.total > 0 ? (r.success / r.total) * 100 : 0;
      let status: string;
      if (r.total === 0) status = 'inactive';
      else if (pct > 95) status = 'healthy';
      else if (pct >= 80) status = 'degraded';
      else status = 'critical';

      return {
        vendor: r.vendor,
        displayName: r.vendor.charAt(0).toUpperCase() + r.vendor.slice(1),
        last24h: { total: r.total, success: r.success, failed: r.failed, avgMs: r.avgMs },
        lastSuccess: r.lastSuccess ?? null,
        lastFailure: r.lastFailure ?? null,
        lastError: r.lastError ?? null,
        status,
      };
    });

    return NextResponse.json({ vendors });
  } catch (err) {
    console.error('[OPS] health error:', err);
    return NextResponse.json(
      { error: 'Failed to load vendor health', detail: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 },
    );
  }
}
