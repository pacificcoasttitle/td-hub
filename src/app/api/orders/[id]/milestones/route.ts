import { NextRequest, NextResponse } from 'next/server';
import { desc, eq, and } from 'drizzle-orm';
import { getSession } from '@/lib/security/auth';
import { canAccessOrder } from '@/lib/security/permissions';
import { db } from '@/lib/db/client';
import { orderStatusHistory } from '@/lib/db/schema';

function milestoneLabel(status: string): string {
  switch (status) {
    case 'recording_confirmation':
      return 'Recording Confirmation';
    case 'disbursement':
      return 'Funds Disbursed';
    default:
      return status
        .split('_')
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
  }
}

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
  if (isNaN(orderId)) {
    return NextResponse.json({ error: 'Invalid order ID' }, { status: 400 });
  }

  if (!(await canAccessOrder(session, orderId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const rows = await db
    .select({
      id: orderStatusHistory.id,
      status: orderStatusHistory.status,
      notes: orderStatusHistory.notes,
      source: orderStatusHistory.source,
      changedAt: orderStatusHistory.changedAt,
    })
    .from(orderStatusHistory)
    .where(and(eq(orderStatusHistory.orderId, orderId), eq(orderStatusHistory.source, 'webhook')))
    .orderBy(desc(orderStatusHistory.changedAt));

  return NextResponse.json({
    milestones: rows.map((row) => ({
      id: row.id,
      status: row.status,
      label: milestoneLabel(row.status),
      notes: row.notes,
      occurredAt: row.changedAt.toISOString(),
    })),
  });
}
