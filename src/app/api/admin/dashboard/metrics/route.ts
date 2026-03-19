import { NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { db } from '@/lib/db/client';
import { orders, vendorApiLogs } from '@/lib/db/schema';
import { sql, eq, and, gte, like, desc } from 'drizzle-orm';

const ADMIN_ROLES = ['super_admin', 'admin', 'cs_admin', 'open_order_team'];

export async function GET() {
  const session = await getSession();
  if (!session || !ADMIN_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const now = new Date();
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [counts] = await db
      .select({
        totalOrders: sql<number>`count(*)`,
        openOrders: sql<number>`count(*) filter (where ${orders.operationalStatus} = 'open')`,
        inProcessOrders: sql<number>`count(*) filter (where ${orders.operationalStatus} = 'in_process')`,
        closedThisMonth: sql<number>`count(*) filter (where ${orders.operationalStatus} = 'closed' and ${orders.closedAt} >= ${firstOfMonth})`,
        canceledOrders: sql<number>`count(*) filter (where ${orders.operationalStatus} = 'canceled')`,
      })
      .from(orders);

    const [syncLog] = await db
      .select({ createdAt: vendorApiLogs.createdAt })
      .from(vendorApiLogs)
      .where(
        and(
          eq(vendorApiLogs.vendor, 'softpro'),
          like(vendorApiLogs.operation, '%sync%'),
          eq(vendorApiLogs.success, true),
        )
      )
      .orderBy(desc(vendorApiLogs.createdAt))
      .limit(1);

    return NextResponse.json({
      totalOrders: Number(counts?.totalOrders ?? 0),
      open: Number(counts?.openOrders ?? 0),
      inProcess: Number(counts?.inProcessOrders ?? 0),
      closedThisMonth: Number(counts?.closedThisMonth ?? 0),
      canceled: Number(counts?.canceledOrders ?? 0),
      lastSynced: syncLog?.createdAt?.toISOString() ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to load metrics', detail: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 },
    );
  }
}
