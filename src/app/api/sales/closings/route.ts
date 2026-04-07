import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { db } from '@/lib/db/client';
import { orders, orderProperties } from '@/lib/db/schema';
import { eq, and, sql, inArray } from 'drizzle-orm';
import { getClosings } from '@/lib/integrations/managers-report';
import { validateSalesAccess, SalesAccessError } from '../_helpers/validate-access';

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const repId = req.nextUrl.searchParams.get('repId');
  const now = new Date();
  const month = Number(req.nextUrl.searchParams.get('month') ?? now.getMonth() + 1);
  const year = Number(req.nextUrl.searchParams.get('year') ?? now.getFullYear());

  try {
    const access = await validateSalesAccess(session, repId);

    const teamIds: number[] =
      access.role === 'sales_manager' && !repId
        ? (access.managedRepIds ?? [access.contactId])
        : [access.contactId];

    // Try Managers Report API first
    try {
      const mr = await getClosings(month, year, access.repName);
      if (mr.success && mr.data && mr.data.closings.length > 0) {
        const closings = mr.data.closings.map(c => ({
          fileNumber: c.fileNumber,
          address: [c.address, c.city, c.state].filter(Boolean).join(', '),
          closedDate: c.closedDate,
          revenue: c.revenue,
        }));
        const total = { count: closings.length, revenue: closings.reduce((s, c) => s + c.revenue, 0) };
        return NextResponse.json({ closings, total });
      }
    } catch { /* MR failure is non-blocking — fall through to local DB */ }

    // Fallback: local orders
    const rows = await db
      .select({
        fileNumber: orders.fileNumber,
        address: orderProperties.address,
        city: orderProperties.city,
        state: orderProperties.state,
        closedAt: orders.closedAt,
        salesPrice: orders.salesPrice,
      })
      .from(orders)
      .leftJoin(orderProperties, eq(orders.id, orderProperties.orderId))
      .where(and(
        inArray(orders.salesRepId, teamIds),
        sql`${orders.closedAt} IS NOT NULL`,
        sql`EXTRACT(MONTH FROM ${orders.closedAt}) = ${month}`,
        sql`EXTRACT(YEAR FROM ${orders.closedAt}) = ${year}`,
      ))
      .orderBy(sql`${orders.closedAt} DESC`);

    const closings = rows.map(r => ({
      fileNumber: r.fileNumber,
      address: [r.address, r.city, r.state].filter(Boolean).join(', ') || '—',
      closedDate: r.closedAt ? new Date(r.closedAt).toISOString() : '',
      revenue: Number(r.salesPrice ?? 0),
    }));
    const total = { count: closings.length, revenue: closings.reduce((s, c) => s + c.revenue, 0) };

    return NextResponse.json({ closings, total });
  } catch (err) {
    if (err instanceof SalesAccessError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      {
        error: 'Failed to load closings',
        ...(process.env.NODE_ENV === 'development' && {
          detail: err instanceof Error ? err.message : 'Unknown',
        }),
      },
      { status: 500 },
    );
  }
}
