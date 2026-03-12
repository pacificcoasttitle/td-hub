import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { orders, documents, titlePointData, orderStatusHistory } from '@/lib/db/schema';
import { eq, and, asc, sql } from 'drizzle-orm';
import { getSession } from '@/lib/security/auth';

interface Milestone {
  name: string;
  status: 'complete' | 'pending';
  date: string | null;
  documentId: number | null;
}

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

    const [order] = await db
      .select({
        id: orders.id,
        operationalStatus: orders.operationalStatus,
        openedAt: orders.openedAt,
        closedAt: orders.closedAt,
      })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    const [firstPrelim, firstCpl, firstPolicy] = await Promise.all([
      firstDocByCategory(orderId, 'prelim'),
      firstDocByCategory(orderId, 'cpl'),
      firstDocByCategory(orderId, 'policy'),
    ]);

    const completedSearch = await db
      .select({ id: titlePointData.id, updatedAt: titlePointData.updatedAt })
      .from(titlePointData)
      .where(and(eq(titlePointData.orderId, orderId), eq(titlePointData.status, 'completed')))
      .orderBy(asc(titlePointData.updatedAt))
      .limit(1);

    const recordingEntry = await db
      .select({ changedAt: orderStatusHistory.changedAt })
      .from(orderStatusHistory)
      .where(and(
        eq(orderStatusHistory.orderId, orderId),
        sql`(lower(${orderStatusHistory.status}) like '%recording%' OR lower(${orderStatusHistory.notes}) like '%recording%')`,
      ))
      .orderBy(asc(orderStatusHistory.changedAt))
      .limit(1);

    const milestones: Milestone[] = [
      {
        name: 'Order Opened',
        status: 'complete',
        date: formatDate(order.openedAt),
        documentId: null,
      },
      {
        name: 'Prelim Received',
        status: firstPrelim ? 'complete' : 'pending',
        date: firstPrelim ? formatDate(firstPrelim.createdAt) : null,
        documentId: firstPrelim?.id ?? null,
      },
      {
        name: 'Title Search Complete',
        status: completedSearch.length > 0 ? 'complete' : 'pending',
        date: completedSearch[0] ? formatDate(completedSearch[0].updatedAt) : null,
        documentId: null,
      },
      {
        name: 'CPL Generated',
        status: firstCpl ? 'complete' : 'pending',
        date: firstCpl ? formatDate(firstCpl.createdAt) : null,
        documentId: firstCpl?.id ?? null,
      },
      {
        name: 'Policy Issued',
        status: firstPolicy ? 'complete' : 'pending',
        date: firstPolicy ? formatDate(firstPolicy.createdAt) : null,
        documentId: firstPolicy?.id ?? null,
      },
      {
        name: 'Recording Confirmation',
        status: recordingEntry.length > 0 ? 'complete' : 'pending',
        date: recordingEntry[0] ? formatDate(recordingEntry[0].changedAt) : null,
        documentId: null,
      },
      {
        name: 'Order Closed',
        status: order.closedAt ? 'complete' : 'pending',
        date: order.closedAt ? formatDate(order.closedAt) : null,
        documentId: null,
      },
    ];

    return NextResponse.json({
      status: order.operationalStatus,
      milestones,
    });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

async function firstDocByCategory(orderId: number, category: string) {
  const rows = await db
    .select({ id: documents.id, createdAt: documents.createdAt })
    .from(documents)
    .where(and(
      eq(documents.orderId, orderId),
      eq(documents.category, category as typeof documents.category.enumValues[number]),
      eq(documents.status, 'active'),
    ))
    .orderBy(asc(documents.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

function formatDate(d: Date | null): string | null {
  if (!d) return null;
  return d.toISOString().slice(0, 10);
}
