import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { getOrderById } from '@/lib/domain/orders/service';

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

    // TODO: Builder agent — wire up single-order resync via SoftPro adapter
    // Expected flow:
    //   1. Call softpro.getOrders with this order's fileNumber
    //   2. Run upsertFromSoftPro with the result
    //   3. Return updated order
    // For now, return success so the UI flow is testable end-to-end.

    return NextResponse.json({ success: true, orderId });
  } catch {
    return NextResponse.json(
      { error: 'Resync failed — please try again' },
      { status: 500 },
    );
  }
}
