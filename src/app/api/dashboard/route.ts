import { NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { db } from '@/lib/db/client';
import { orders, jobs, orderProperties } from '@/lib/db/schema';
import { eq, sql, desc, count } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

async function safeQuery<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); }
  catch { return fallback; }
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [orderStats, jobStats, recentOrderRows] = await Promise.all([
    safeQuery(async () => {
      const [totalResult, openResult, closedResult] = await Promise.all([
        db.select({ value: count() }).from(orders),
        db.select({ value: count() }).from(orders).where(sql`${orders.operationalStatus} = 'open'`),
        db.select({ value: count() }).from(orders).where(sql`${orders.operationalStatus} = 'closed' AND ${orders.closedAt} >= ${monthStart}`),
      ]);
      return {
        totalOrders: totalResult[0]?.value ?? 0,
        openOrders: openResult[0]?.value ?? 0,
        closedThisMonth: closedResult[0]?.value ?? 0,
      };
    }, { totalOrders: 0, openOrders: 0, closedThisMonth: 0 }),

    safeQuery(async () => {
      const [failedJobsResult, lastSyncResult, lastSyncJobResult] = await Promise.all([
        db.select({ value: count() }).from(jobs).where(sql`${jobs.status} = 'failed'`),
        db.select({ endedAt: jobs.endedAt }).from(jobs)
          .where(sql`${jobs.jobType} = 'softpro.sync_recent_orders' AND ${jobs.status} = 'completed'`)
          .orderBy(desc(jobs.endedAt)).limit(1),
        db.select({ status: jobs.status, endedAt: jobs.endedAt, startedAt: jobs.startedAt, error: jobs.error }).from(jobs)
          .where(sql`${jobs.jobType} = 'softpro.sync_recent_orders'`)
          .orderBy(desc(jobs.createdAt)).limit(1),
      ]);
      const lastSyncJob = lastSyncJobResult[0] ?? null;
      return {
        failedJobs: failedJobsResult[0]?.value ?? 0,
        lastSyncAt: lastSyncResult[0]?.endedAt?.toISOString() ?? null,
        lastSync: lastSyncJob ? {
          status: lastSyncJob.status,
          endedAt: lastSyncJob.endedAt?.toISOString() ?? null,
          startedAt: lastSyncJob.startedAt?.toISOString() ?? null,
          error: lastSyncJob.error,
        } : null,
      };
    }, { failedJobs: 0, lastSyncAt: null, lastSync: null }),

    safeQuery(() =>
      db.select({
        id: orders.id,
        fileNumber: orders.fileNumber,
        operationalStatus: orders.operationalStatus,
        transactionType: orders.transactionType,
        openedAt: orders.openedAt,
        closedAt: orders.closedAt,
        address: orderProperties.address,
        city: orderProperties.city,
        state: orderProperties.state,
        county: orderProperties.county,
      })
      .from(orders)
      .leftJoin(orderProperties, eq(orders.id, orderProperties.orderId))
      .orderBy(desc(orders.openedAt))
      .limit(5),
    [] as Array<{ id: number; fileNumber: string; operationalStatus: string; transactionType: string | null; openedAt: Date; closedAt: Date | null; address: string | null; city: string | null; state: string | null; county: string | null }>),
  ]);

  return NextResponse.json({
    stats: {
      ...orderStats,
      lastSyncAt: jobStats.lastSyncAt,
    },
    webhooks: {
      todayCount: 0,
      latestAt: null,
      failedToday: 0,
    },
    systemHealth: {
      lastSync: jobStats.lastSync,
      failedJobs: jobStats.failedJobs,
      documentsUploadedToday: 0,
      documentAttachFailuresToday: 0,
    },
    recentOrders: recentOrderRows.map((row) => ({
      id: row.id,
      fileNumber: row.fileNumber,
      operationalStatus: row.operationalStatus,
      transactionType: row.transactionType,
      openedAt: row.openedAt,
      closedAt: row.closedAt,
      property: row.address ? { address: row.address, city: row.city, state: row.state, county: row.county } : null,
    })),
  });
}
