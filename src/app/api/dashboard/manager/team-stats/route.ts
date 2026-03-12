import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { db } from '@/lib/db/client';
import { orders } from '@/lib/db/schema';
import { sql, and, eq, SQL } from 'drizzle-orm';
import { getLeaderboard } from '@/lib/integrations/managers-report';

const ADMIN_ROLES = ['super_admin', 'admin'];

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ADMIN_ROLES.includes(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const branchParam = req.nextUrl.searchParams.get('branch');
  const branchId = branchParam ? Number(branchParam) : null;

  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  const conditions: SQL[] = [];
  if (branchId) conditions.push(eq(orders.branchId, branchId));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [result] = await db.select({
    totalOpen: sql<number>`count(*) filter (where ${orders.operationalStatus} in ('open', 'in_process'))`,
    totalClosedThisMonth: sql<number>`count(*) filter (where ${orders.operationalStatus} = 'closed' and ${orders.closedAt} >= ${monthStart})`,
    teamPipelineValue: sql<number>`coalesce(sum(${orders.salesPrice}::numeric) filter (where ${orders.operationalStatus} in ('open', 'in_process')), 0)`,
  }).from(orders).where(where);

  let teamRevenue: number | null = null;
  try {
    const lb = await getLeaderboard();
    if (lb.success && lb.data) {
      teamRevenue = lb.data.leaderboard.reduce((sum, e) => sum + e.mtdRevenue, 0);
    }
  } catch { /* non-blocking */ }

  return NextResponse.json({
    totalOpen: Number(result?.totalOpen ?? 0),
    totalClosedThisMonth: Number(result?.totalClosedThisMonth ?? 0),
    teamPipelineValue: Number(result?.teamPipelineValue ?? 0),
    teamRevenue,
  });
}
