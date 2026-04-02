import { NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { db } from '@/lib/db/client';
import { vendorApiLogs } from '@/lib/db/schema';
import { desc, gte, eq, and, sql } from 'drizzle-orm';

const ADMIN_ROLES = ['super_admin', 'admin', 'cs_admin'];

let cached: { data: unknown; expiresAt: number } | null = null;
const CACHE_TTL_MS = 60_000;

export async function GET() {
  const session = await getSession();
  if (!session || !ADMIN_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(cached.data);
  }

  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [vendorStats, recentErrors] = await Promise.all([
      db.select({
        vendor: vendorApiLogs.vendor,
        total: sql<number>`count(*)`,
        successCount: sql<number>`count(case when ${vendorApiLogs.success} then 1 end)`,
        errorCount: sql<number>`count(case when not ${vendorApiLogs.success} then 1 end)`,
        avgResponseMs: sql<number>`coalesce(round(avg(extract(epoch from (${vendorApiLogs.endedAt} - ${vendorApiLogs.startedAt})) * 1000)), 0)`,
      })
        .from(vendorApiLogs)
        .where(gte(vendorApiLogs.createdAt, since))
        .groupBy(vendorApiLogs.vendor)
        .orderBy(sql`count(*) desc`),

      db.select({
        id: vendorApiLogs.id,
        vendor: vendorApiLogs.vendor,
        operation: vendorApiLogs.operation,
        orderId: vendorApiLogs.orderId,
        httpStatus: vendorApiLogs.httpStatus,
        errorCategory: vendorApiLogs.errorCategory,
        createdAt: vendorApiLogs.createdAt,
      })
        .from(vendorApiLogs)
        .where(and(
          gte(vendorApiLogs.createdAt, since),
          eq(vendorApiLogs.success, false),
        ))
        .orderBy(desc(vendorApiLogs.id))
        .limit(5),
    ]);

    const result = {
      vendors: vendorStats.map((v) => ({
        vendor: v.vendor,
        total: Number(v.total),
        successCount: Number(v.successCount),
        errorCount: Number(v.errorCount),
        avgResponseMs: Number(v.avgResponseMs),
      })),
      recentErrors,
    };

    cached = { data: result, expiresAt: Date.now() + CACHE_TTL_MS };

    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
