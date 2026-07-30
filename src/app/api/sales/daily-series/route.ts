import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { getClosings } from '@/lib/integrations/managers-report';
import { summariseSevenDays, type ClosingEntryLike } from '@/lib/domain/sales/header-metrics';
import { validateSalesAccess, SalesAccessError } from '../_helpers/validate-access';

// Trailing seven days of closings for the sales dashboard strip.
//
// Managers Report has no daily-by-rep endpoint, so this buckets the per-file
// closings feed (each entry carries closedDate + revenue) into days. That keeps
// the strip on the same authoritative source as the rest of the header.
//
// Distinct from /api/sales/daily, which is manager-only and returns a
// single-day leaderboard across reps.

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const repId = req.nextUrl.searchParams.get('repId');

  try {
    const access = await validateSalesAccess(session, repId);
    const now = new Date();

    const month = now.getMonth() + 1;
    const year = now.getFullYear();

    // The seven-day window can reach back into the previous month.
    const windowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
    const spansPriorMonth = windowStart.getMonth() !== now.getMonth();
    const priorMonth = month === 1 ? 12 : month - 1;
    const priorYear = month === 1 ? year - 1 : year;

    const [currentRes, priorRes] = await Promise.all([
      getClosings(month, year, access.repName),
      spansPriorMonth
        ? getClosings(priorMonth, priorYear, access.repName)
        : Promise.resolve(null),
    ]);

    // Degrade rather than fabricate: without the current month we have no strip.
    if (!currentRes.success || !currentRes.data) {
      return NextResponse.json({ available: false, reason: 'closings_unavailable' });
    }

    const currentEntries = (currentRes.data.closings ?? []) as ClosingEntryLike[];
    const priorEntries = (priorRes?.success && priorRes.data?.closings
      ? priorRes.data.closings
      : []) as ClosingEntryLike[];

    const summary = summariseSevenDays([...priorEntries, ...currentEntries], now);

    return NextResponse.json({
      available: true,
      days: summary.days,
      totalClosings: summary.totalClosings,
      totalRevenue: summary.totalRevenue,
      bestDay: summary.bestDay,
      // Month-to-date average uses the current month only.
      monthDailyAvg: summariseSevenDays(currentEntries, now).monthDailyAvg,
    });
  } catch (err) {
    if (err instanceof SalesAccessError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      {
        error: 'Internal server error',
        ...(process.env.NODE_ENV === 'development' && {
          detail: err instanceof Error ? err.message : 'Unknown',
        }),
      },
      { status: 500 },
    );
  }
}
