import { NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { db } from '@/lib/db/client';
import { orders, branches } from '@/lib/db/schema';
import { sql, eq } from 'drizzle-orm';

const ADMIN_ROLES = ['super_admin', 'admin'];

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ADMIN_ROLES.includes(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const rows = await db
    .select({
      branchId: branches.id,
      branchCode: branches.code,
      branchName: branches.name,
      openOrders: sql<number>`count(*) filter (where ${orders.operationalStatus} in ('open', 'in_process'))`,
      closedOrders: sql<number>`count(*) filter (where ${orders.operationalStatus} = 'closed')`,
      totalOrders: sql<number>`count(*)`,
    })
    .from(branches)
    .leftJoin(orders, eq(orders.branchId, branches.id))
    .where(eq(branches.isActive, true))
    .groupBy(branches.id, branches.code, branches.name)
    .orderBy(branches.code);

  const mapped = rows.map((r) => ({
    branchId: r.branchId,
    branchCode: r.branchCode,
    branchName: r.branchName,
    openOrders: Number(r.openOrders),
    closedOrders: Number(r.closedOrders),
    totalOrders: Number(r.totalOrders),
  }));

  return NextResponse.json({ branches: mapped });
}
