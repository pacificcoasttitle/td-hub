import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { clientCreateOrder } from '@/lib/domain/orders/client-create-order';

const SOFTPRO_CONFIG_ERROR_MESSAGE = 'Order could not be sent to SoftPro — service configuration error';

function sanitizeCreateOrderError(message: string | undefined): string {
  if (!message) return 'Order creation failed';
  if (message.includes('SOFTPRO_')) return SOFTPRO_CONFIG_ERROR_MESSAGE;
  return message;
}

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

    const result = await clientCreateOrder(body as Record<string, unknown>, session, session.id);

    if (!result.success) {
      return NextResponse.json({
        error: sanitizeCreateOrderError(result.error),
        fileNumber: result.fileNumber,
        orderId: result.orderId,
        createdInSoftPro: result.createdInSoftPro,
        submitLocked: result.submitLocked,
      }, { status: 422 });
    }

    return NextResponse.json({
      success: true,
      orderId: result.orderId,
      fileNumber: result.fileNumber,
      createdInSoftPro: result.createdInSoftPro,
      submitLocked: result.submitLocked,
    }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
