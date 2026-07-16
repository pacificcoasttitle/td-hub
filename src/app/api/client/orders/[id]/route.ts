import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { canAccessOrder } from '@/lib/security/client-scope';
import { applyVisibility, getOrderReadModel } from '@/lib/domain/orders/read-model';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const orderId = parseInt(id, 10);
    if (isNaN(orderId)) {
      return NextResponse.json({ error: 'Invalid order ID' }, { status: 400 });
    }

    const allowed = await canAccessOrder(session.id, orderId);
    if (!allowed) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const model = await getOrderReadModel(orderId);
    if (!model) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }
    const visible = applyVisibility(model, 'client');

    return NextResponse.json({
      id: visible.id,
      fileNumber: visible.fileNumber,
      operationalStatus: visible.status.value,
      transactionType: visible.transactionType,
      openedAt: visible.dates.openedAt,
      completedAt: visible.dates.completedAt,
      closedAt: visible.dates.closedAt,
      property: visible.property.addressFormatted !== '—'
        ? {
            address: visible.property.line1,
            city: visible.property.city,
            state: visible.property.state,
            zip: visible.property.zip,
            county: visible.property.county === '—' ? null : visible.property.county,
            fullAddress: visible.property.addressFormatted,
          }
        : null,
      documents: visible.documents.active,
    });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
