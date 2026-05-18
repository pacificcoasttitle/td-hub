import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { canAccessOrder } from '@/lib/security/permissions';
import { getProposedInsuredPrefill } from '@/lib/domain/documents/proposed-insured';

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

    if (!(await canAccessOrder(session, orderId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const prefill = await getProposedInsuredPrefill(orderId);
    if (!prefill) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    return NextResponse.json(prefill);
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
