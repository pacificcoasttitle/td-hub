import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { db } from '@/lib/db/client';
import { vendorApiLogs } from '@/lib/db/schema';
import { sql, gte, and, lt } from 'drizzle-orm';
import { classifyVendorStatus } from '@/lib/domain/ops/vendor-health';

const ADMIN_ROLES = ['super_admin', 'admin'];

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
    const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [realtimeRows, monthlyRows] = await Promise.all([
      db
        .select({
          vendor: vendorApiLogs.vendor,
          total: sql<number>`count(*)::int`,
          success: sql<number>`count(*) filter (where ${vendorApiLogs.success} = true)::int`,
          failed: sql<number>`count(*) filter (where ${vendorApiLogs.success} = false or ${vendorApiLogs.success} is null)::int`,
          avgMs: sql<number>`coalesce(avg(extract(epoch from (${vendorApiLogs.endedAt} - ${vendorApiLogs.startedAt})) * 1000)::int, 0)`,
          lastSuccess: sql<string>`max(case when ${vendorApiLogs.success} = true then ${vendorApiLogs.createdAt} end)`,
          lastFailure: sql<string>`max(case when ${vendorApiLogs.success} = false or ${vendorApiLogs.success} is null then ${vendorApiLogs.createdAt} end)`,
        })
        .from(vendorApiLogs)
        .where(gte(vendorApiLogs.createdAt, cutoff24h))
        .groupBy(vendorApiLogs.vendor),

      db
        .select({
          vendor: vendorApiLogs.vendor,
          total: sql<number>`count(*)::int`,
          success: sql<number>`count(*) filter (where ${vendorApiLogs.success} = true)::int`,
          failed: sql<number>`count(*) filter (where ${vendorApiLogs.success} = false or ${vendorApiLogs.success} is null)::int`,
        })
        .from(vendorApiLogs)
        .where(and(gte(vendorApiLogs.createdAt, monthStart), lt(vendorApiLogs.createdAt, monthEnd)))
        .groupBy(vendorApiLogs.vendor),
    ]);

    const monthlyMap = new Map(monthlyRows.map(r => [r.vendor, r]));

    type VendorEntry = {
      vendor: string; displayName: string;
      health: { status: string; lastSuccess: string | null; lastFailure: string | null };
      last24h: { total: number; success: number; failed: number; avgMs: number };
      monthly: { total: number; success: number; failed: number };
    };

    const vendors: VendorEntry[] = realtimeRows.map((r) => {
      // Volume-aware: a percentage over a handful of calls cannot raise an
      // alarm. See src/lib/domain/ops/vendor-health.ts.
      const status = classifyVendorStatus({ total: r.total, success: r.success });

      const m = monthlyMap.get(r.vendor);
      return {
        vendor: r.vendor,
        displayName: r.vendor.charAt(0).toUpperCase() + r.vendor.slice(1),
        health: { status, lastSuccess: r.lastSuccess ?? null, lastFailure: r.lastFailure ?? null },
        last24h: { total: r.total, success: r.success, failed: r.failed, avgMs: r.avgMs },
        monthly: { total: m?.total ?? 0, success: m?.success ?? 0, failed: m?.failed ?? 0 },
      };
    });

    // Include vendors that appear in monthly data but not in 24h data
    for (const m of monthlyRows) {
      if (!realtimeRows.find(r => r.vendor === m.vendor)) {
        vendors.push({
          vendor: m.vendor,
          displayName: m.vendor.charAt(0).toUpperCase() + m.vendor.slice(1),
          health: { status: 'inactive', lastSuccess: null, lastFailure: null },
          last24h: { total: 0, success: 0, failed: 0, avgMs: 0 },
          monthly: { total: m.total, success: m.success, failed: m.failed },
        });
      }
    }

    return NextResponse.json({ vendors });
  } catch (err) {
    console.error('[OPS] health error:', err);
    return NextResponse.json(
      { error: 'Failed to load vendor health', detail: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 },
    );
  }
}
