import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { canAccessOrder } from '@/lib/security/permissions';
import { resolvePrelimRecipients } from '@/lib/domain/notifications/prelim-recipient-resolution';
import { getPrelimDeliveryEligibility } from '@/lib/domain/notifications/prelim-delivery-eligibility';

const ADMIN_ROLES = ['super_admin', 'admin', 'cs_admin', 'open_order_team', 'escrow_assistant'];
const paramSchema = z.object({ id: z.coerce.number().int().positive() });

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || !ADMIN_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = paramSchema.safeParse(await params);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid order ID' }, { status: 400 });
  }

  const orderId = parsed.data.id;
  if (!(await canAccessOrder(session, orderId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    const [eligibility, resolution] = await Promise.all([
      getPrelimDeliveryEligibility(orderId),
      resolvePrelimRecipients(orderId),
    ]);

    if (eligibility.blocked) {
      return NextResponse.json({
        ...resolution,
        blocked: true,
        blockReason: eligibility.blockReason,
      });
    }

    return NextResponse.json(resolution);
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to resolve prelim recipients', detail: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 },
    );
  }
}
