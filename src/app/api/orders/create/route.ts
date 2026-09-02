import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { createAndSendToSoftPro } from '@/lib/domain/orders/create-order';

/**
 * Who may open an order. NOT the admin list — deliberately named apart from it.
 *
 * `open_order_team` is the role that actually does this work: Amna, Shean and
 * Emelio have opened 24 of the 40 hub orders through this route. It is wider
 * than `ADMIN_ROLES` in src/lib/security/auth.ts, which is
 * ['super_admin','admin','cs_admin'] and does NOT include them.
 *
 * Both constants were called ADMIN_ROLES. Reading the name here and attaching
 * the other one's meaning to it produced a scope document claiming
 * open_order_team could not reach this endpoint, and an hour spent chasing a
 * permission defect that does not exist. The names differ now so that the two
 * cannot be confused by anyone reading only one of them.
 *
 * A survey of the rest is in docs/tickets/ROLE_CONSTANTS_SHARE_NAMES.md: 32
 * local ADMIN_ROLES with THREE different contents, and 35 local ALLOWED_ROLES
 * with TWELVE.
 */
const ORDER_CREATE_ROLES = ['super_admin', 'admin', 'cs_admin', 'open_order_team', 'escrow_assistant'];
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
  if (!ORDER_CREATE_ROLES.includes(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const body: unknown = await req.json();
    const result = await createAndSendToSoftPro(body, 'manual_entry', session.id);

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
    return NextResponse.json({ error: 'Order creation failed' }, { status: 500 });
  }
}
