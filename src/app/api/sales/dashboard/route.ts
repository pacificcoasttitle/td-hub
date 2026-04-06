import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { orders } from '@/lib/db/schema';
import { getScopedStats, getScopedOrders } from '@/lib/domain/orders/scoped-queries';
import { getRepFigures } from '@/lib/integrations/managers-report';
import { validateSalesAccess, SalesAccessError } from '../_helpers/validate-access';
import type { RepFigures, MtdBreakdown } from '@/lib/integrations/managers-report/types';

function extractCount(v: MtdBreakdown): number {
  return typeof v === 'number' ? v : v.count;
}

function extractRevenue(v: MtdBreakdown): number {
  return typeof v === 'number' ? v : v.revenue;
}

function mapRepFigures(f: RepFigures) {
  return {
    mtd: {
      revenue: f.mtd.revenue,
      closed: f.mtd.closed,
      purchase: extractCount(f.mtd.purchase),
      refinance: extractCount(f.mtd.refinance),
      escrow: extractCount(f.mtd.escrow),
      tsg: extractCount(f.mtd.tsg),
      purchaseRevenue: extractRevenue(f.mtd.purchase),
      refinanceRevenue: extractRevenue(f.mtd.refinance),
      escrowRevenue: extractRevenue(f.mtd.escrow),
      tsgRevenue: extractRevenue(f.mtd.tsg),
    },
    yesterday: { closed: f.yesterday.closed, revenue: f.yesterday.revenue, opens: f.yesterday.opens },
    prior: { closed: f.prior.closed, revenue: f.prior.revenue },
    ranking: { position: f.ranking.position, totalReps: f.ranking.totalReps },
    closingRatio: { closed: f.closingRatio.closed, total: f.closingRatio.created },
    projected: { revenue: f.projected, workingDaysLeft: f.workingDays.remaining },
  };
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const repId = req.nextUrl.searchParams.get('repId');
  const page = Number(req.nextUrl.searchParams.get('page') ?? '1');
  const pageSize = Number(req.nextUrl.searchParams.get('pageSize') ?? '25');
  const status = req.nextUrl.searchParams.get('status') ?? undefined;

  try {
    const access = await validateSalesAccess(session, repId);

    const [stats, ordersResult] = await Promise.all([
      getScopedStats(orders.salesRepId, access.contactId),
      getScopedOrders({ scopeColumn: orders.salesRepId, contactId: access.contactId, page, pageSize, status }),
    ]);

    let repFigures: ReturnType<typeof mapRepFigures> | null = null;
    try {
      if (access.repName) {
        const result = await getRepFigures(access.repName);
        if (result.success && result.data) {
          repFigures = mapRepFigures(result.data);
        }
      }
    } catch { /* MR API failure is non-blocking */ }

    return NextResponse.json({
      openOrders: stats.open,
      closedThisMonth: stats.closedThisMonth,
      pipelineValue: stats.pipelineValue,
      assignedOrders: stats.assigned,
      mtd: repFigures?.mtd ?? null,
      yesterday: repFigures?.yesterday ?? null,
      prior: repFigures?.prior ?? null,
      ranking: repFigures?.ranking ?? null,
      closingRatio: repFigures?.closingRatio ?? null,
      projected: repFigures?.projected ?? null,
      orders: ordersResult.orders,
      ordersTotal: ordersResult.total,
      ordersPage: ordersResult.page,
      ordersPageSize: ordersResult.pageSize,
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
