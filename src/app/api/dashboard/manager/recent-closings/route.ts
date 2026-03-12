import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { db } from '@/lib/db/client';
import { orders, orderProperties, contacts } from '@/lib/db/schema';
import { eq, desc, isNotNull } from 'drizzle-orm';

const ADMIN_ROLES = ['super_admin', 'admin'];

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ADMIN_ROLES.includes(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const limitParam = req.nextUrl.searchParams.get('limit');
  const limit = Math.min(Number(limitParam ?? '20'), 50);

  const rows = await db
    .select({
      fileNumber: orders.fileNumber,
      closedAt: orders.closedAt,
      address: orderProperties.fullAddress,
      salesRepName: contacts.fullName,
    })
    .from(orders)
    .leftJoin(orderProperties, eq(orders.id, orderProperties.orderId))
    .leftJoin(contacts, eq(orders.salesRepId, contacts.id))
    .where(isNotNull(orders.closedAt))
    .orderBy(desc(orders.closedAt))
    .limit(limit);

  return NextResponse.json({ closings: rows });
}
