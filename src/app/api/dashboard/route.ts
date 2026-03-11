import { NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { orders, jobs, orderProperties } from '@/lib/db/schema';
import { eq, sql, desc, and, gte } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      totalResult,
      openResult,
      closedThisMonthResult,
      lastSyncResult,
      recentOrderRows,
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
    ]);

    return NextResponse.json({
      stats: {
        totalOrders: Number(totalResult[0]?.count ?? 0),
        openOrders: Number(openResult[0]?.count ?? 0),
        closedThisMonth: Number(closedThisMonthResult[0]?.count ?? 0),
        lastSyncAt: lastSyncResult[0]?.endedAt?.toISOString() ?? null,
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
