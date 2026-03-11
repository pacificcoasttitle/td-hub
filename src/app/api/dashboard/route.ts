import { NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { db } from '@/lib/db/client';
import { orders, jobs, orderProperties, vendorApiLogs, documentAudit } from '@/lib/db/schema';
import { eq, sql, desc, and, gte } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

const WEBHOOK_VENDOR = 'softpro_webhook';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [
      totalResult,
      openResult,
      closedThisMonthResult,
      lastSyncResult,
      recentOrderRows,
      webhooksTodayResult,
      webhookLatestResult,
      webhooksFailedResult,
      failedJobsResult,
      lastSyncJobResult,
      uploadsToday,
      attachFailuresToday,
    ] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(orders),

      db
        .select({ count: sql<number>`count(*)` })
        .from(orders)
        .where(eq(orders.operationalStatus, 'open')),

      db
        .select({ count: sql<number>`count(*)` })
        .from(orders)
        .where(
          and(
            eq(orders.operationalStatus, 'closed'),
            gte(orders.closedAt, monthStart),
          ),
        ),

      db
        .select({ endedAt: jobs.endedAt })
        .from(jobs)
        .where(
          and(
            eq(jobs.jobType, 'softpro.sync_recent_orders'),
            eq(jobs.status, 'completed'),
          ),
        )
        .orderBy(desc(jobs.endedAt))
        .limit(1),

      db
        .select()
        .from(orders)
        .leftJoin(orderProperties, eq(orders.id, orderProperties.orderId))
        .orderBy(desc(orders.openedAt))
        .limit(5),

      // Webhooks today
      db
        .select({ count: sql<number>`count(*)` })
        .from(vendorApiLogs)
        .where(
          and(
            eq(vendorApiLogs.vendor, WEBHOOK_VENDOR),
            gte(vendorApiLogs.createdAt, todayStart),
          ),
        ),

      // Latest webhook ever
      db
        .select({ createdAt: vendorApiLogs.createdAt })
        .from(vendorApiLogs)
        .where(eq(vendorApiLogs.vendor, WEBHOOK_VENDOR))
        .orderBy(desc(vendorApiLogs.createdAt))
        .limit(1),

      // Failed webhooks today
      db
        .select({ count: sql<number>`count(*)` })
        .from(vendorApiLogs)
        .where(
          and(
            eq(vendorApiLogs.vendor, WEBHOOK_VENDOR),
            eq(vendorApiLogs.success, false),
            gte(vendorApiLogs.createdAt, todayStart),
          ),
        ),

      // Failed jobs (any time — actionable backlog)
      db
        .select({ count: sql<number>`count(*)` })
        .from(jobs)
        .where(eq(jobs.status, 'failed')),

      // Last sync job (any status — for system health)
      db
        .select({
          status: jobs.status,
          endedAt: jobs.endedAt,
          startedAt: jobs.startedAt,
          error: jobs.error,
        })
        .from(jobs)
        .where(eq(jobs.jobType, 'softpro.sync_recent_orders'))
        .orderBy(desc(jobs.createdAt))
        .limit(1),

      // Document uploads today
      db
        .select({ count: sql<number>`count(*)` })
        .from(documentAudit)
        .where(
          and(
            eq(documentAudit.action, 'uploaded'),
            gte(documentAudit.performedAt, todayStart),
          ),
        ),

      // Document attach failures today
      db
        .select({ count: sql<number>`count(*)` })
        .from(documentAudit)
        .where(
          and(
            eq(documentAudit.action, 'attach_failed'),
            gte(documentAudit.performedAt, todayStart),
          ),
        ),
    ]);

    const lastSyncJob = lastSyncJobResult[0] ?? null;

    return NextResponse.json({
      stats: {
        totalOrders: Number(totalResult[0]?.count ?? 0),
        openOrders: Number(openResult[0]?.count ?? 0),
        closedThisMonth: Number(closedThisMonthResult[0]?.count ?? 0),
        lastSyncAt: lastSyncResult[0]?.endedAt?.toISOString() ?? null,
      },
      webhooks: {
        todayCount: Number(webhooksTodayResult[0]?.count ?? 0),
        latestAt: webhookLatestResult[0]?.createdAt?.toISOString() ?? null,
        failedToday: Number(webhooksFailedResult[0]?.count ?? 0),
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
        failedJobs: Number(failedJobsResult[0]?.count ?? 0),
        documentsUploadedToday: Number(uploadsToday[0]?.count ?? 0),
        documentAttachFailuresToday: Number(attachFailuresToday[0]?.count ?? 0),
      },
      recentOrders: recentOrderRows.map((row) => ({
        ...row.orders,
        property: row.order_properties,
      })),
    });
  } catch {
    return NextResponse.json(
      { error: 'Failed to load dashboard data' },
      { status: 500 },
    );
  }
}
