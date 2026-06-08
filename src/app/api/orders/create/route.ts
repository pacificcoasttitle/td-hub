import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { createAndSendToSoftPro } from '@/lib/domain/orders/create-order';

const ADMIN_ROLES = ['super_admin', 'admin', 'cs_admin', 'open_order_team', 'escrow_assistant'];
const SOFTPRO_CONFIG_ERROR_MESSAGE = 'Order could not be sent to SoftPro — service configuration error';

export const maxDuration = 300;

function sanitizeCreateOrderError(message: string | undefined): string {
  if (!message) return 'Order creation failed';
  if (message.includes('SOFTPRO_')) return SOFTPRO_CONFIG_ERROR_MESSAGE;
  return message;
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ADMIN_ROLES.includes(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const body: unknown = await req.json();
    const result = await createAndSendToSoftPro(body, session.id);

    if (!result.success) {
      return NextResponse.json({ error: sanitizeCreateOrderError(result.error) }, { status: 422 });
    }

    return NextResponse.json({
      success: true,
      orderId: result.orderId,
      fileNumber: result.fileNumber,
    }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Order creation failed' }, { status: 500 });
  }
}
