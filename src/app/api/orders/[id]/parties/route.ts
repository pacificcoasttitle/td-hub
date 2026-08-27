import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { canAccessOrderDetailResource } from '@/lib/security/permissions';
import { getOrderParties } from '@/lib/domain/orders/order-parties';

// Read-only. The detail pane renders instantly from the list row and this
// fills the parties section in behind it, so a slow query can never make j/k
// feel slow.

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const orderId = parseInt(id, 10);
  if (Number.isNaN(orderId)) {
    return NextResponse.json({ error: 'Invalid order ID' }, { status: 400 });
  }

  if (!(await canAccessOrderDetailResource(session, orderId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const result = await getOrderParties(orderId);
  return NextResponse.json(result);
}
