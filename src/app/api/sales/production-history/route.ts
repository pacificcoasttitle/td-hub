import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { getProductionHistory } from '@/lib/integrations/managers-report';
import { validateSalesAccess, SalesAccessError } from '../_helpers/validate-access';

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const repId = req.nextUrl.searchParams.get('repId');
  const yearParam = req.nextUrl.searchParams.get('year');
  const year = yearParam ? Number(yearParam) : new Date().getFullYear();

  try {
    const access = await validateSalesAccess(session, repId);

    const result = await getProductionHistory(year, access.repName);

    if (!result.success || !result.data || result.data.months.length === 0) {
      return NextResponse.json({ year, months: [] });
    }

    const months = result.data.months.map((m, idx) => {
      const prev = idx > 0 ? result.data!.months[idx - 1] : null;
      let trend: 'up' | 'down' | 'flat' = 'flat';
      if (prev) {
        if (m.revenue > prev.revenue) trend = 'up';
        else if (m.revenue < prev.revenue) trend = 'down';
      }
      return {
        month: m.month,
        monthName: m.monthName,
        openings: m.openings,
        closings: m.closings,
        revenue: m.revenue,
        ratio: m.closingRatio,
        trend,
      };
    });

    return NextResponse.json({ year: result.data.year, months });
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
