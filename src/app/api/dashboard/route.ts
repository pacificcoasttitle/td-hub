import { NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { db } from '@/lib/db/client';
import { orders, jobs, orderProperties } from '@/lib/db/schema';
import { eq, sql, desc, count } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [totalResult, openResult, closedResult, failedJobsResult] = await Promise.all([
      db.select({ value: count() }).from(orders),
      db.select({ value: count() }).from(orders).where(sql`${orders.operationalStatus} = 'open'`),
      db.select({ value: count() }).from(orders).where(sql`${orders.operationalStatus} = 'closed' AND ${orders.closedAt} >= ${monthStart}`),
      db.select({ value: count() }).from(jobs).where(sql`${jobs.status} = 'failed'`),
    ]);

    const lastSyncResult = await db
      .select({ endedAt: jobs.endedAt })
      .from(jobs)
      .where(sql`${jobs.jobType} = 'softpro.sync_recent_orders' AND ${jobs.status} = 'completed'`)
      .orderBy(desc(jobs.endedAt))
      .limit(1);

    const lastSyncJobResult = await db
      .select({ status: jobs.status, endedAt: jobs.endedAt, startedAt: jobs.startedAt, error: jobs.error })
      .from(jobs)
      .where(sql`${jobs.jobType} = 'softpro.sync_recent_orders'`)
      .orderBy(desc(jobs.createdAt))
      .limit(1);

    const recentOrderRows = await db
      .select({
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
      .limit(5);

    const lastSyncJob = lastSyncJobResult[0] ?? null;

    return NextResponse.json({
      stats: {
        totalOrders: totalResult[0]?.value ?? 0,
        openOrders: openResult[0]?.value ?? 0,
        closedThisMonth: closedResult[0]?.value ?? 0,
        lastSyncAt: lastSyncResult[0]?.endedAt?.toISOString() ?? null,
      },
      webhooks: {
        todayCount: 0,
        latestAt: null,
        failedToday: 0,
      },
      systemHealth: {
        lastSync: lastSyncJob
          ? {
              status: lastSyncJob.status,
              endedAt: lastSyncJob.endedAt?.toISOString() ?? null,
              startedAt: lastSyncJob.startedAt?.toISOString() ?? null,
              error: lastSyncJob.error,
            }
          : null,
        failedJobs: failedJobsResult[0]?.value ?? 0,
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
  } catch (err) {
    console.error('[dashboard] Error:', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to load dashboard data', detail: message },
      { status: 500 },
    );
  }
}
