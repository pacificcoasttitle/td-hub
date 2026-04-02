import { NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { db } from '@/lib/db/client';
import { orders, vendorApiLogs } from '@/lib/db/schema';
import { sql, eq, and } from 'drizzle-orm';

const ADMIN_ROLES = ['super_admin', 'admin', 'cs_admin', 'open_order_team'];

function toIsoOrNull(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

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
      .select({
        lastSyncAt: sql<Date | string | null>`max(${vendorApiLogs.createdAt})`,
      })
      .from(vendorApiLogs)
      .where(
        and(
          eq(vendorApiLogs.vendor, 'softpro'),
          eq(vendorApiLogs.success, true),
        )
      );

    const lastSyncAt = toIsoOrNull(syncLog?.lastSyncAt);

    return NextResponse.json({
      totalOrders: Number(counts?.totalOrders ?? 0),
      open: Number(counts?.openOrders ?? 0),
      inProcess: Number(counts?.inProcessOrders ?? 0),
      closedThisMonth: Number(counts?.closedThisMonth ?? 0),
      canceled: Number(counts?.canceledOrders ?? 0),
      lastSyncAt,
      lastSynced: lastSyncAt,
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to load metrics', detail: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 },
    );
  }
}
