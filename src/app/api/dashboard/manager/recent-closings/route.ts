import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { db } from '@/lib/db/client';
import { orders, orderProperties, contacts } from '@/lib/db/schema';
import { eq, desc, isNotNull, and, inArray, SQL } from 'drizzle-orm';
import { getManagedRepIds } from '@/lib/domain/contacts/managed-reps';

const ALLOWED_ROLES = ['super_admin', 'admin', 'sales_manager'];

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ALLOWED_ROLES.includes(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const limitParam = req.nextUrl.searchParams.get('limit');
  const limit = Math.min(Number(limitParam ?? '20'), 50);

  const conditions: SQL[] = [isNotNull(orders.closedAt)];

  if (session.role === 'sales_manager' && session.contactId) {
    const repIds = await getManagedRepIds(session.contactId);
    if (repIds.length === 0) return NextResponse.json({ closings: [] });
    conditions.push(inArray(orders.salesRepId, repIds));
  }

  const rows = await db
    .select({
      id: orders.id,
      fileNumber: orders.fileNumber,
      closedAt: orders.closedAt,
      salesRepName: contacts.fullName,
      address: orderProperties.address,
      city: orderProperties.city,
      state: orderProperties.state,
    })
    .from(orders)
    .leftJoin(orderProperties, eq(orders.id, orderProperties.orderId))
    .leftJoin(contacts, eq(orders.salesRepId, contacts.id))
    .where(and(...conditions))
    .orderBy(desc(orders.closedAt))
    .limit(limit);

  const closings = rows.map((r) => ({
    id: String(r.id),
    fileNumber: r.fileNumber,
    salesRepName: r.salesRepName ?? '',
    closedAt: r.closedAt?.toISOString() ?? '',
    property: {
      address: r.address ?? '',
      city: r.city ?? '',
      state: r.state ?? '',
    },
  }));

  return NextResponse.json({ closings });
}
