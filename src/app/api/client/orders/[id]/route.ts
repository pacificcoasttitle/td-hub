import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { orders, orderProperties, documents } from '@/lib/db/schema';
import { eq, desc, and } from 'drizzle-orm';
import { getSession } from '@/lib/security/auth';

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

    const result = await db
      .select()
      .from(orders)
      .leftJoin(orderProperties, eq(orders.id, orderProperties.orderId))
      .where(eq(orders.id, orderId))
      .limit(1);

    if (result.length === 0) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    const docs = await db
      .select({
        id: documents.id,
        filename: documents.filename,
        category: documents.category,
        sizeBytes: documents.sizeBytes,
        createdAt: documents.createdAt,
      })
      .from(documents)
      .where(and(eq(documents.orderId, orderId), eq(documents.status, 'active')))
      .orderBy(desc(documents.createdAt));

    const row = result[0]!;
    return NextResponse.json({
      id: row.orders.id,
      fileNumber: row.orders.fileNumber,
      operationalStatus: row.orders.operationalStatus,
      transactionType: row.orders.transactionType,
      openedAt: row.orders.openedAt,
      completedAt: row.orders.completedAt,
      closedAt: row.orders.closedAt,
      property: row.order_properties
        ? {
            address: row.order_properties.address,
            city: row.order_properties.city,
            state: row.order_properties.state,
            county: row.order_properties.county,
            fullAddress: row.order_properties.fullAddress,
          }
        : null,
      documents: docs,
    });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
