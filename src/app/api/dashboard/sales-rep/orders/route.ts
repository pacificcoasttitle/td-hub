import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { orders } from '@/lib/db/schema';
import { getScopedOrders } from '@/lib/domain/orders/scoped-queries';

const ALLOWED_ROLES = ['sales_rep', 'super_admin', 'admin', 'cs_admin'];

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ALLOWED_ROLES.includes(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!session.contactId) return NextResponse.json({ error: 'Profile not linked to a contact' }, { status: 422 });

  const params = req.nextUrl.searchParams;
  const page = Number(params.get('page') ?? '1');
  const pageSize = Math.min(Number(params.get('pageSize') ?? '25'), 100);
  const status = params.get('status') ?? undefined;

  const result = await getScopedOrders({
    scopeColumn: orders.salesRepId,
    contactId: session.contactId,
    page, pageSize, status,
  });

  return NextResponse.json(result);
}
