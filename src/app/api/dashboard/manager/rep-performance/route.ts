import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { db } from '@/lib/db/client';
import { orders, contacts } from '@/lib/db/schema';
import { sql, eq, and, or } from 'drizzle-orm';
import { getLeaderboard } from '@/lib/integrations/managers-report';
import { nameVariants } from '@/lib/domain/contacts/name-mapping';

const ADMIN_ROLES = ['super_admin', 'admin'];

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ADMIN_ROLES.includes(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const branchParam = req.nextUrl.searchParams.get('branch');
  const branchId = branchParam ? Number(branchParam) : null;

  const lbResult = await getLeaderboard();
  if (!lbResult.success || !lbResult.data) {
    return NextResponse.json({ month: null, leaderboard: [] });
  }

  const allContacts = await db
    .select({ id: contacts.id, fullName: contacts.fullName, officerName: contacts.officerName })
    .from(contacts)
    .where(sql`${contacts.roles} @> '["Sales Rep"]'::jsonb`);

  const enriched = await Promise.all(
    lbResult.data.leaderboard.map(async (entry) => {
      const match = resolveContact(entry.salesRep, allContacts);
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

  return NextResponse.json({ month: lbResult.data.month, leaderboard: enriched });
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
