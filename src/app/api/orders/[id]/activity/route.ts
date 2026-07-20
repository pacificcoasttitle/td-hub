import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { canAccessOrderDetailResource } from '@/lib/security/permissions';
import { getOrderActivity } from '@/lib/domain/orders/activity';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const orderId = parseInt(id, 10);
    if (isNaN(orderId)) {
      return NextResponse.json({ error: 'Invalid order ID' }, { status: 400 });
    }

    if (!(await canAccessOrderDetailResource(session, orderId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const limit = Math.min(
      parseInt(req.nextUrl.searchParams.get('limit') ?? '30', 10) || 30,
      100,
    );

    const { activity } = await getOrderActivity(orderId, 'staff', { limit });
    return NextResponse.json({ activity });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
