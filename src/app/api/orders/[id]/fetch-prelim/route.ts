import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { getOrderById } from '@/lib/domain/orders/service';
import { fetchPrelimsForOrder } from '@/lib/jobs/handlers/fetch-prelims';

const ADMIN_ROLES = ['super_admin', 'admin', 'cs_admin'];

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session || !ADMIN_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const orderId = parseInt(id, 10);
    if (isNaN(orderId)) {
      return NextResponse.json({ error: 'Invalid order ID' }, { status: 400 });
    }

    const order = await getOrderById(orderId);
    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    const documentsStored = await fetchPrelimsForOrder(orderId, order.fileNumber);

    return NextResponse.json({
      success: true,
      documentsFound: documentsStored,
      documentsStored,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Prelim fetch failed' },
      { status: 500 },
    );
  }
}
