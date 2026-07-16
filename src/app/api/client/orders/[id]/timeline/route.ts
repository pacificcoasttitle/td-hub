import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { canAccessOrder } from '@/lib/security/client-scope';
import { applyVisibility, getOrderReadModel } from '@/lib/domain/orders/read-model';

interface Milestone {
  name: string;
  status: 'complete' | 'in_progress' | 'pending';
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

    const allowed = await canAccessOrder(session.id, orderId);
    if (!allowed) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const model = await getOrderReadModel(orderId);
    if (!model) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }
    const visible = applyVisibility(model, 'client');
    const milestones: Milestone[] = visible.milestones.map((milestone) => ({
      name: milestone.label,
      status: milestone.state,
      date: milestone.date === '—' ? null : milestone.date,
      documentId: milestone.documentId,
    }));

    return NextResponse.json({
      status: visible.status.value,
      milestones,
    });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
