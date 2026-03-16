import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { clientCreateOrder } from '@/lib/domain/orders/client-create-order';

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const result = await clientCreateOrder(body as Record<string, unknown>, session);

    if (!result.success) {
      return NextResponse.json({ error: result.error ?? 'Order creation failed' }, { status: 422 });
    }

    return NextResponse.json({
      success: true,
      orderId: result.orderId,
      fileNumber: result.fileNumber,
    }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
