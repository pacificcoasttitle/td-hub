import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { canAccessOrder } from '@/lib/security/permissions';
import { enrichSingleOrder } from '@/lib/jobs/handlers/enrich-orders';

export async function POST(
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

  const canAccess = await canAccessOrder(session, orderId);
  if (!canAccess) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    const result = await enrichSingleOrder(orderId);
    if (!result.success) {
      return NextResponse.json({ error: result.error ?? 'Enrichment failed' }, { status: result.error === 'Order not found' ? 404 : 502 });
    }
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: 'Enrichment failed', detail: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 },
    );
  }
}
