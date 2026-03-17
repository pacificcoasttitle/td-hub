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
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);

    const [vendorStats, recentErrors] = await Promise.all([
      db.select({
        vendor: vendorApiLogs.vendor,
        total: sql<number>`count(*)`,
        successes: sql<number>`count(*) filter (where ${vendorApiLogs.success} = true)`,
        errors: sql<number>`count(*) filter (where ${vendorApiLogs.success} = false)`,
        avgDurationMs: sql<number>`round(avg(extract(epoch from (${vendorApiLogs.endedAt} - ${vendorApiLogs.startedAt})) * 1000))`,
      })
        .from(vendorApiLogs)
        .where(gte(vendorApiLogs.createdAt, startOfToday))
        .groupBy(vendorApiLogs.vendor),

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
          gte(vendorApiLogs.createdAt, startOfToday),
          eq(vendorApiLogs.success, false),
        ))
        .orderBy(desc(vendorApiLogs.id))
        .limit(5),
    ]);

    const result = {
      date: startOfToday.toISOString().slice(0, 10),
      vendors: vendorStats.map((v) => ({
        vendor: v.vendor,
        total: Number(v.total),
        successes: Number(v.successes),
        errors: Number(v.errors),
        avgDurationMs: v.avgDurationMs ? Number(v.avgDurationMs) : null,
      })),
      recentErrors,
    };

    cached = { data: result, expiresAt: Date.now() + CACHE_TTL_MS };

    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
