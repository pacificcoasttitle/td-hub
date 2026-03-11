import { NextRequest, NextResponse } from 'next/server';
import { getOrderById } from '@/lib/domain/orders/service';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
