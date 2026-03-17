import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { createAndSendToSoftPro } from '@/lib/domain/orders/create-order';

const ADMIN_ROLES = ['super_admin', 'admin', 'cs_admin', 'open_order_team'];

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ADMIN_ROLES.includes(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const body: unknown = await req.json();
    const result = await createAndSendToSoftPro(body);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 422 });
    }

    return NextResponse.json({
      success: true,
      orderId: result.orderId,
      fileNumber: result.fileNumber,
    }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Order creation failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
