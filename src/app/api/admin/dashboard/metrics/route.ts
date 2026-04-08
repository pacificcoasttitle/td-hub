import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { db } from '@/lib/db/client';
import { orders, vendorApiLogs } from '@/lib/db/schema';
import { sql, eq, and } from 'drizzle-orm';
import { getMonthRange } from '@/lib/utils/month-range';

const ADMIN_ROLES = ['super_admin', 'admin', 'cs_admin', 'open_order_team'];

function toIsoOrNull(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !ADMIN_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { month, year, start, end } = getMonthRange(
      req.nextUrl.searchParams.get('month'),
      req.nextUrl.searchParams.get('year'),
    );

    const [counts] = await db
      .select({
        totalOrders: sql<number>`count(*) filter (where ${orders.createdAt} >= ${start} and ${orders.createdAt} < ${end})`,
        open: sql<number>`count(*) filter (where ${orders.operationalStatus} = 'open' and ${orders.createdAt} >= ${start} and ${orders.createdAt} < ${end})`,
        inProcess: sql<number>`count(*) filter (where ${orders.operationalStatus} = 'in_process' and ${orders.createdAt} >= ${start} and ${orders.createdAt} < ${end})`,
        closedThisMonth: sql<number>`count(*) filter (where ${orders.operationalStatus} = 'closed' and ${orders.closedAt} >= ${start} and ${orders.closedAt} < ${end})`,
        canceled: sql<number>`count(*) filter (where ${orders.operationalStatus} = 'canceled' and ${orders.updatedAt} >= ${start} and ${orders.updatedAt} < ${end})`,
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
      month,
      year,
      totalOrders: Number(counts?.totalOrders ?? 0),
      open: Number(counts?.open ?? 0),
      inProcess: Number(counts?.inProcess ?? 0),
      closedThisMonth: Number(counts?.closedThisMonth ?? 0),
      canceled: Number(counts?.canceled ?? 0),
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
