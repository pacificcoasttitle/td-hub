import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { db } from '@/lib/db/client';
import { orders, contacts } from '@/lib/db/schema';
import { sql, eq, and, or, inArray } from 'drizzle-orm';
import { getLeaderboard } from '@/lib/integrations/managers-report';
import { nameVariants } from '@/lib/domain/contacts/name-mapping';
import { getManagedRepIds } from '@/lib/domain/contacts/managed-reps';

const ALLOWED_ROLES = ['super_admin', 'admin', 'sales_manager'];

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ALLOWED_ROLES.includes(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const branchParam = req.nextUrl.searchParams.get('branch');
  const branchId = branchParam ? Number(branchParam) : null;

  let managedRepIds: number[] | null = null;
  if (session.role === 'sales_manager' && session.contactId) {
    managedRepIds = await getManagedRepIds(session.contactId);
    if (managedRepIds.length === 0) return NextResponse.json({ month: null, leaderboard: [] });
  }

  const lbResult = await getLeaderboard();
  if (!lbResult.success || !lbResult.data) {
    return NextResponse.json({ month: null, leaderboard: [] });
  }

  const repFilter = managedRepIds ? and(eq(contacts.isSalesRep, true), inArray(contacts.id, managedRepIds)) : eq(contacts.isSalesRep, true);
  const allContacts = await db
    .select({ id: contacts.id, fullName: contacts.fullName, officerName: contacts.officerName })
    .from(contacts)
    .where(repFilter)
    .limit(200);

  const contactIdSet = managedRepIds ? new Set(managedRepIds) : null;

  const enriched = await Promise.all(
    lbResult.data.leaderboard.map(async (entry) => {
      const match = resolveContact(entry.salesRep, allContacts);
      if (contactIdSet && match && !contactIdSet.has(match.id)) return null;
      if (contactIdSet && !match) return null;

      let localOpenOrders: number | null = null;
      if (match) {
        const conditions = [eq(orders.salesRepId, match.id), sql`${orders.operationalStatus} in ('open', 'in_process')`];
        if (branchId) conditions.push(eq(orders.branchId, branchId));
        const [row] = await db.select({ count: sql<number>`count(*)` }).from(orders).where(and(...conditions));
        localOpenOrders = Number(row?.count ?? 0);
      }

      return { ...entry, localOpenOrders, contactId: match?.id ?? null };
    })
  );

  return NextResponse.json({ month: lbResult.data.month, leaderboard: enriched.filter(Boolean) });
}

type ContactRow = { id: number; fullName: string | null; officerName: string | null };

function resolveContact(reportName: string, contactList: ContactRow[]): ContactRow | null {
  const variants = nameVariants(reportName);
  for (const v of variants) {
    const lower = v.toLowerCase();
    const match = contactList.find(
      (c) => c.fullName?.toLowerCase() === lower || c.officerName?.toLowerCase() === lower
    );
    if (match) return match;
  }
  return null;
}
