import { NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { db } from '@/lib/db/client';
import { orders, jobs, orderProperties } from '@/lib/db/schema';
import { eq, sql, desc } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

const WEBHOOK_VENDOR = 'softpro_webhook';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // Single query: all scalar counts via subqueries (1 connection)
    const [counts] = await db.execute<{
      total_orders: string;
      open_orders: string;
      closed_this_month: string;
      webhooks_today: string;
      webhooks_failed: string;
      failed_jobs: string;
      uploads_today: string;
      attach_failures: string;
    }>(sql`
      SELECT
        (SELECT count(*) FROM orders) AS total_orders,
        (SELECT count(*) FROM orders WHERE operational_status = 'open') AS open_orders,
        (SELECT count(*) FROM orders WHERE operational_status = 'closed' AND closed_at >= ${monthStart}) AS closed_this_month,
        (SELECT count(*) FROM vendor_api_logs WHERE vendor = ${WEBHOOK_VENDOR} AND created_at >= ${todayStart}) AS webhooks_today,
        (SELECT count(*) FROM vendor_api_logs WHERE vendor = ${WEBHOOK_VENDOR} AND success = false AND created_at >= ${todayStart}) AS webhooks_failed,
        (SELECT count(*) FROM jobs WHERE status = 'failed') AS failed_jobs,
        (SELECT count(*) FROM document_audit WHERE action = 'uploaded' AND performed_at >= ${todayStart}) AS uploads_today,
        (SELECT count(*) FROM document_audit WHERE action = 'attach_failed' AND performed_at >= ${todayStart}) AS attach_failures
    `);

    // Sequential queries for rows that need structured results (1 connection each)
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

    const webhookLatestResult = await db.execute<{ latest_at: string | null }>(sql`
      SELECT max(created_at) AS latest_at FROM vendor_api_logs WHERE vendor = ${WEBHOOK_VENDOR}
    `);

    const recentOrderRows = await db
      .select()
      .from(orders)
      .leftJoin(orderProperties, eq(orders.id, orderProperties.orderId))
      .orderBy(desc(orders.openedAt))
      .limit(5);

    const lastSyncJob = lastSyncJobResult[0] ?? null;

    return NextResponse.json({
      stats: {
        totalOrders: Number(counts?.total_orders ?? 0),
        openOrders: Number(counts?.open_orders ?? 0),
        closedThisMonth: Number(counts?.closed_this_month ?? 0),
        lastSyncAt: lastSyncResult[0]?.endedAt?.toISOString() ?? null,
      },
      webhooks: {
        todayCount: Number(counts?.webhooks_today ?? 0),
        latestAt: webhookLatestResult[0]?.latest_at ?? null,
        failedToday: Number(counts?.webhooks_failed ?? 0),
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
        failedJobs: Number(counts?.failed_jobs ?? 0),
        documentsUploadedToday: Number(counts?.uploads_today ?? 0),
        documentAttachFailuresToday: Number(counts?.attach_failures ?? 0),
      },
      recentOrders: recentOrderRows.map((row) => ({
        ...row.orders,
        property: row.order_properties,
      })),
    });
  } catch (err) {
    console.error('[dashboard] Error:', err);
    return NextResponse.json(
      { error: 'Failed to load dashboard data' },
      { status: 500 },
    );
  }
}
