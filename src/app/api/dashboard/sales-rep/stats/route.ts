import { NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { orders } from '@/lib/db/schema';
import { getScopedStats } from '@/lib/domain/orders/scoped-queries';
import { getRepFigures } from '@/lib/integrations/managers-report';
import { contactNameToReportName } from '@/lib/domain/contacts/name-mapping';

const ALLOWED_ROLES = ['sales_rep', 'super_admin', 'admin', 'cs_admin'];

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ALLOWED_ROLES.includes(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!session.contactId) return NextResponse.json({ error: 'Profile not linked to a contact' }, { status: 422 });

  const stats = await getScopedStats(orders.salesRepId, session.contactId);

  let revenue: { mtdRevenue: number; mtdClosed: number; projected: number; ranking: { position: number; totalReps: number } } | null = null;
  try {
    if (session.displayName) {
      const reportName = contactNameToReportName(session.displayName);
      const result = await getRepFigures(reportName);
      if (result.success && result.data) {
        revenue = {
          mtdRevenue: result.data.mtd.revenue,
          mtdClosed: result.data.mtd.closed,
          projected: result.data.projected,
          ranking: result.data.ranking,
        };
      }
    }
  } catch { /* Managers Report API failure is non-blocking */ }

  return NextResponse.json({
    openOrders: stats.open,
    closedThisMonth: stats.closedThisMonth,
    pipelineValue: stats.pipelineValue,
    assignedOrders: stats.assigned,
    revenue,
  });
}
