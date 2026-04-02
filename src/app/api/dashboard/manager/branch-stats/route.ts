import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { db } from '@/lib/db/client';
import { orders, branches } from '@/lib/db/schema';
import { sql, eq, and, inArray, SQL } from 'drizzle-orm';
import { getManagedRepIds } from '@/lib/domain/contacts/managed-reps';

const ALLOWED_ROLES = ['super_admin', 'admin', 'sales_manager'];

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ALLOWED_ROLES.includes(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let repFilter: SQL | undefined;
  if (session.role === 'sales_manager' && session.contactId) {
    const repIds = await getManagedRepIds(session.contactId);
    if (repIds.length === 0) return NextResponse.json({ branches: [] });
    repFilter = inArray(orders.salesRepId, repIds);
  }

  const joinCondition = repFilter
    ? and(eq(orders.branchId, branches.id), repFilter)
    : eq(orders.branchId, branches.id);

  const rows = await db
    .select({
      branchId: branches.id,
      branchCode: branches.code,
      branchName: branches.name,
      openOrders: sql<number>`count(*) filter (where ${orders.operationalStatus} in ('open', 'in_process'))`,
      closedOrders: sql<number>`count(*) filter (where ${orders.operationalStatus} = 'closed')`,
      totalOrders: sql<number>`count(${orders.id})`,
    })
    .from(branches)
    .leftJoin(orders, joinCondition)
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
