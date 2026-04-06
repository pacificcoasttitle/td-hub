import { NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { db } from '@/lib/db/client';
import { contacts } from '@/lib/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { getManagedRepIds } from '@/lib/domain/contacts/managed-reps';
import { getLeaderboard } from '@/lib/integrations/managers-report';
import { contactNameToReportName } from '@/lib/domain/contacts/name-mapping';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'sales_manager') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!session.contactId) return NextResponse.json({ error: 'Profile not linked to a contact' }, { status: 422 });

  try {
    const managedIds = await getManagedRepIds(session.contactId);
    const allIds = [session.contactId, ...managedIds];

    const repRows = await db
      .select({ id: contacts.id, fullName: contacts.fullName })
      .from(contacts)
      .where(and(inArray(contacts.id, allIds), eq(contacts.isSalesRep, true)));

    const nameSet = new Map<string, string>();
    for (const r of repRows) {
      const reportName = contactNameToReportName(r.fullName);
      if (reportName) nameSet.set(reportName.toLowerCase(), reportName);
    }

    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const lb = await getLeaderboard(month);

    if (!lb.success || !lb.data) {
      return NextResponse.json({ reps: [], totals: { openings: 0, closings: 0, revenue: 0 } });
    }

    const filtered = lb.data.leaderboard
      .filter((e) => nameSet.has(e.salesRep.toLowerCase()))
      .sort((a, b) => b.mtdRevenue - a.mtdRevenue)
      .map((e) => ({
        name: e.salesRep,
        openings: e.mtdOpens,
        closings: e.mtdClosed,
        revenue: e.mtdRevenue,
      }));

    const totals = filtered.reduce(
      (acc, r) => ({ openings: acc.openings + r.openings, closings: acc.closings + r.closings, revenue: acc.revenue + r.revenue }),
      { openings: 0, closings: 0, revenue: 0 },
    );

    return NextResponse.json({ reps: filtered, totals });
  } catch (err) {
    return NextResponse.json(
      { error: 'Internal server error', ...(process.env.NODE_ENV === 'development' && { detail: err instanceof Error ? err.message : 'Unknown' }) },
      { status: 500 },
    );
  }
}
