import { NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { orders } from '@/lib/db/schema';
import { getScopedStats } from '@/lib/domain/orders/scoped-queries';
import { getRepFigures } from '@/lib/integrations/managers-report';
import { contactNameToReportName } from '@/lib/domain/contacts/name-mapping';
import type { RepFigures } from '@/lib/integrations/managers-report/types';

const ALLOWED_ROLES = ['sales_rep', 'super_admin', 'admin', 'cs_admin'];

function mapRepFigures(f: RepFigures) {
  return {
    mtd: {
      revenue: f.mtd.revenue,
      closed: f.mtd.closed,
      purchase: f.mtd.purchase,
      refinance: f.mtd.refinance,
      escrow: f.mtd.escrow,
      tsg: f.mtd.tsg,
      // TODO: Managers Report API does not provide per-type revenue breakdowns yet
      purchaseRevenue: 0,
      refinanceRevenue: 0,
      escrowRevenue: 0,
      tsgRevenue: 0,
    },
    yesterday: {
      closed: f.yesterday.closed,
      revenue: f.yesterday.revenue,
      opens: f.yesterday.opens,
    },
    prior: {
      closed: f.prior.closed,
      revenue: f.prior.revenue,
    },
    ranking: {
      position: f.ranking.position,
      totalReps: f.ranking.totalReps,
    },
    closingRatio: {
      closed: f.closingRatio.closed,
      total: f.closingRatio.created,
    },
    projected: {
      revenue: f.projected,
      workingDaysLeft: f.workingDays.remaining,
    },
  };
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ALLOWED_ROLES.includes(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!session.contactId) return NextResponse.json({ error: 'Profile not linked to a contact' }, { status: 422 });

  const stats = await getScopedStats(orders.salesRepId, session.contactId);

  let mtd: ReturnType<typeof mapRepFigures>['mtd'] | null = null;
  let yesterday: ReturnType<typeof mapRepFigures>['yesterday'] | null = null;
  let prior: ReturnType<typeof mapRepFigures>['prior'] | null = null;
  let ranking: ReturnType<typeof mapRepFigures>['ranking'] | null = null;
  let closingRatio: ReturnType<typeof mapRepFigures>['closingRatio'] | null = null;
  let projected: ReturnType<typeof mapRepFigures>['projected'] | null = null;

  try {
    if (session.displayName) {
      const reportName = contactNameToReportName(session.displayName);
      const result = await getRepFigures(reportName);
      if (result.success && result.data) {
        const mapped = mapRepFigures(result.data);
        mtd = mapped.mtd;
        yesterday = mapped.yesterday;
        prior = mapped.prior;
        ranking = mapped.ranking;
        closingRatio = mapped.closingRatio;
        projected = mapped.projected;
      }
    }
  } catch { /* Managers Report API failure is non-blocking */ }

  return NextResponse.json({
    openOrders: stats.open,
    closedThisMonth: stats.closedThisMonth,
    pipelineValue: stats.pipelineValue,
    assignedOrders: stats.assigned,
    mtd,
    yesterday,
    prior,
    ranking,
    closingRatio,
    projected,
  });
}
