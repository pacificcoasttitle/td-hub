import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { db } from '@/lib/db/client';
import { orders, documents } from '@/lib/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { getScopedOrders } from '@/lib/domain/orders/scoped-queries';
import { validateSalesAccess, SalesAccessError } from '../_helpers/validate-access';
import { getMonthRange } from '@/lib/utils/month-range';

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const repIdParam = sp.get('repId');
  const page = Math.max(1, Number(sp.get('page') ?? '1'));
  const pageSize = Math.min(Math.max(1, Number(sp.get('pageSize') ?? '25')), 100);
  const status = sp.get('status')?.trim() || undefined;
  const search = sp.get('search')?.trim() || undefined;
  const monthParam = sp.get('month');
  const yearParam = sp.get('year');
  const openedRange = monthParam || yearParam ? getMonthRange(monthParam, yearParam) : null;

  try {
    const access = await validateSalesAccess(session, repIdParam);

    const ordersResult = await getScopedOrders({
      scopeColumn: orders.salesRepId,
      contactId: access.contactId,
      contactIds: access.contactIds,
      page,
      pageSize,
      status,
      search,
      openedStart: openedRange?.start,
      openedEnd: openedRange?.end,
    });

    const orderIds = ordersResult.orders.map(o => o.id);
    let prelimSet = new Set<number>();
    if (orderIds.length > 0) {
      const prelimRows = await db
        .selectDistinct({ orderId: documents.orderId })
        .from(documents)
        .where(and(
          inArray(documents.orderId, orderIds),
          eq(documents.category, 'prelim'),
          eq(documents.status, 'active'),
        ));
      prelimSet = new Set(prelimRows.map(r => r.orderId));
    }

    const enrichedOrders = ordersResult.orders.map(o => ({
      ...o,
      hasPrelim: prelimSet.has(o.id),
    }));

    return NextResponse.json({
      orders: enrichedOrders,
      total: ordersResult.total,
      page: ordersResult.page,
      pageSize: ordersResult.pageSize,
    });
  } catch (err) {
    if (err instanceof SalesAccessError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: 'Internal server error', ...(process.env.NODE_ENV === 'development' && { detail: err instanceof Error ? err.message : 'Unknown' }) },
      { status: 500 },
    );
  }
}
