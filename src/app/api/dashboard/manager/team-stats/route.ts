import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { db } from '@/lib/db/client';
import { orders, contacts } from '@/lib/db/schema';
import { sql, and, eq, inArray, SQL } from 'drizzle-orm';
import { getLeaderboard } from '@/lib/integrations/managers-report';
import { getManagedRepIds } from '@/lib/domain/contacts/managed-reps';
import { contactNameToReportName } from '@/lib/domain/contacts/name-mapping';

const ALLOWED_ROLES = ['super_admin', 'admin', 'sales_manager'];

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ALLOWED_ROLES.includes(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const branchParam = req.nextUrl.searchParams.get('branch');
  const branchId = branchParam ? Number(branchParam) : null;
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

  try {
    const conditions: SQL[] = [];
    if (branchId) conditions.push(eq(orders.branchId, branchId));

    if (session.role === 'sales_manager' && session.contactId) {
      const repIds = await getManagedRepIds(session.contactId);
      if (repIds.length === 0) {
        return NextResponse.json({ totalOpen: 0, totalClosedThisMonth: 0, teamPipelineValue: 0, teamRevenue: null });
      }
      conditions.push(inArray(orders.salesRepId, repIds));
    }

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
        let entries = lb.data.leaderboard;

        if (session.role === 'sales_manager' && session.contactId) {
          const repIds = await getManagedRepIds(session.contactId);
          const allIds = [session.contactId, ...repIds];
          const repNames = await db.select({ fullName: contacts.fullName }).from(contacts)
            .where(inArray(contacts.id, allIds));
          const nameSet = new Set(
            repNames.map((r) => contactNameToReportName(r.fullName)?.toLowerCase()).filter(Boolean),
          );
          entries = entries.filter((e) => nameSet.has(e.salesRep.toLowerCase()));
        }

        teamRevenue = entries.reduce((sum, e) => sum + e.mtdRevenue, 0);
      }
    } catch { /* non-blocking */ }

    return NextResponse.json({
      totalOpen: Number(result?.totalOpen ?? 0),
      totalClosedThisMonth: Number(result?.totalClosedThisMonth ?? 0),
      teamPipelineValue: Number(result?.teamPipelineValue ?? 0),
      teamRevenue,
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to load team stats', detail: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 },
    );
  }
}
