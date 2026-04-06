import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { db } from '@/lib/db/client';
import { contacts } from '@/lib/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { getManagedRepIds } from '@/lib/domain/contacts/managed-reps';
import { getLeaderboard } from '@/lib/integrations/managers-report';
import { contactNameToReportName } from '@/lib/domain/contacts/name-mapping';

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'sales_manager') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!session.contactId) return NextResponse.json({ error: 'Profile not linked to a contact' }, { status: 422 });

  const monthParam = req.nextUrl.searchParams.get('month');
  const yearParam = req.nextUrl.searchParams.get('year');

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
    const y = yearParam ? Number(yearParam) : now.getFullYear();
    const m = monthParam ? Number(monthParam) : now.getMonth() + 1;
    const monthStr = `${y}-${String(m).padStart(2, '0')}`;

    const lb = await getLeaderboard(monthStr);
    if (!lb.success || !lb.data) {
      return NextResponse.json({ reps: [] });
    }

    const filtered = lb.data.leaderboard
      .filter((e) => nameSet.has(e.salesRep.toLowerCase()))
      .sort((a, b) => b.mtdRevenue - a.mtdRevenue)
      .map((e, idx) => ({
        rank: idx + 1,
        name: e.salesRep,
        openings: e.mtdOpens,
        closings: e.mtdClosed,
        revenue: e.mtdRevenue,
        ratio: e.mtdOpens > 0 ? Math.round((e.mtdClosed / e.mtdOpens) * 100) : 0,
      }));

    return NextResponse.json({ reps: filtered });
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to load ranking', detail: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 },
    );
  }
}
