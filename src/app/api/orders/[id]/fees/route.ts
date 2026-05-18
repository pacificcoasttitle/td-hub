import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { canAccessOrder } from '@/lib/security/permissions';
import { getOrderByIdSimple } from '@/lib/domain/orders/service';
import { getFees } from '@/lib/integrations/softpro';

export async function GET(
  _req: NextRequest,
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

    const canAccess = await canAccessOrder(session, orderId);
    if (!canAccess) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const order = await getOrderByIdSimple(orderId);
    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    const result = await getFees(order.fileNumber);
    if (!result.success || !result.data) {
      return NextResponse.json({
        success: false,
        error: result.error?.message ?? 'Failed to retrieve fees',
      });
    }

    const invoices = result.data.map((inv) => ({
      invoiceNumber: inv.InvoiceNumber,
      fees: inv.Fees.map((f) => ({
        description: f.Description,
        amount: f.Amount,
      })),
      total: inv.Total.Amount,
    }));

    const grandTotal = invoices.reduce((sum, inv) => sum + inv.total, 0);

    return NextResponse.json({
      success: true,
      data: { invoices, grandTotal },
    });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
