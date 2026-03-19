import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { enrichSingleOrder } from '@/lib/jobs/handlers/enrich-orders';

const ADMIN_ROLES = ['super_admin', 'admin', 'cs_admin', 'open_order_team'];

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || !ADMIN_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const orderId = Number(id);
  if (!orderId || isNaN(orderId)) {
    return NextResponse.json({ error: 'Invalid order ID' }, { status: 400 });
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
