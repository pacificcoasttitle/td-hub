import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { getClientSummary } from '@/lib/integrations/managers-report';
import { validateSalesAccess, SalesAccessError } from '../_helpers/validate-access';

const EMPTY_TOTALS = {
  totalClients: 0, repeatClients: 0, newClients: 0,
  topClientRevenue: 0, avgDealsPerClient: 0, totalRevenue: 0, totalDeals: 0,
};

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const repId = req.nextUrl.searchParams.get('repId');
  const yearParam = req.nextUrl.searchParams.get('year');
  const year = yearParam ? Number(yearParam) : new Date().getFullYear();

  try {
    const access = await validateSalesAccess(session, repId);

    const result = await getClientSummary(year, access.repName);

    if (!result.success || !result.data) {
      return NextResponse.json({ year, totals: EMPTY_TOTALS, clients: [] });
    }

    return NextResponse.json(result.data);
  } catch (err) {
    if (err instanceof SalesAccessError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      {
        error: 'Failed to load client summary',
        ...(process.env.NODE_ENV === 'development' && {
          detail: err instanceof Error ? err.message : 'Unknown',
        }),
      },
      { status: 500 },
    );
  }
}
