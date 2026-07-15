import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { canAccessOrder } from '@/lib/security/permissions';
import { resolvePrelimRecipients } from '@/lib/domain/notifications/prelim-recipient-resolution';
import { getPrelimDeliveryEligibility } from '@/lib/domain/notifications/prelim-delivery-eligibility';

const ADMIN_ROLES = ['super_admin', 'admin', 'cs_admin', 'open_order_team', 'escrow_assistant'];
const paramSchema = z.object({ id: z.coerce.number().int().positive() });
const recipientSchema = z.object({
  email: z.string().email(),
  name: z.string().nullable().optional(),
  role: z.string().min(1),
  source: z.string().optional(),
});
const bodySchema = z.object({
  to: recipientSchema,
  cc: z.array(recipientSchema).default([]),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || !ADMIN_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsedParams = paramSchema.safeParse(await params);
  if (!parsedParams.success) {
    return NextResponse.json({ error: 'Invalid order ID' }, { status: 400 });
  }

  const orderId = parsedParams.data.id;
  if (!(await canAccessOrder(session, orderId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const parsedBody = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsedBody.success) {
    return NextResponse.json({ error: 'Invalid recipients', details: parsedBody.error.issues }, { status: 400 });
  }

  try {
    const [eligibility, currentResolution] = await Promise.all([
      getPrelimDeliveryEligibility(orderId),
      resolvePrelimRecipients(orderId),
    ]);

    if (eligibility.blocked) {
      return NextResponse.json(
        { error: eligibility.blockReason ?? 'Prelim delivery is not available for this order' },
        { status: 409 },
      );
    }

    if (currentResolution.blocked || !currentResolution.to) {
      return NextResponse.json(
        { error: currentResolution.blockReason ?? 'No valid escrow-officer recipient resolved' },
        { status: 409 },
      );
    }

    return NextResponse.json({
      success: true,
      sent: false,
      stub: true,
      message: 'D4 stub accepted reviewed prelim recipients. D5 will wire the real email send.',
      reviewedRecipients: parsedBody.data,
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'Prelim delivery stub failed', detail: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 },
    );
  }
}
