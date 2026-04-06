import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { getTrends } from '@/lib/integrations/managers-report';
import { validateSalesAccess, SalesAccessError } from '../_helpers/validate-access';

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const repId = req.nextUrl.searchParams.get('repId');

  try {
    const access = await validateSalesAccess(session, repId);

    const result = await getTrends(access.repName);

    if (!result.success || !result.data) {
      const now = new Date();
      return NextResponse.json({
        currentYear: { year: now.getFullYear(), months: [] },
        priorYear: { year: now.getFullYear() - 1, months: [] },
      });
    }

    return NextResponse.json({
      currentYear: result.data.currentYear,
      priorYear: result.data.priorYear,
    });
  } catch (err) {
    if (err instanceof SalesAccessError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: 'Failed to load trends', detail: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 },
    );
  }
}
