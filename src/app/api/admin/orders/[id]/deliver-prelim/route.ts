import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { canAccessOrder } from '@/lib/security/permissions';
import { resolvePrelimRecipients } from '@/lib/domain/notifications/prelim-recipient-resolution';
import { getPrelimDeliveryEligibility } from '@/lib/domain/notifications/prelim-delivery-eligibility';
import { PRELIM_DELIVERY_NOT_ARMED } from '@/lib/domain/notifications/prelim-delivery-mode';
import {
  sendPrelimDeliveryEmail,
  type ReviewedPrelimRecipients,
} from '@/lib/domain/notifications/prelim-delivery-send';

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

function normalizeReviewedRecipients(
  data: z.infer<typeof bodySchema>,
  resolvedTo: ReviewedPrelimRecipients['to'],
): ReviewedPrelimRecipients {
  return {
    to: resolvedTo,
    cc: data.cc.map((recipient) => ({
      email: recipient.email,
      name: recipient.name ?? null,
      role: recipient.role,
      source: recipient.source,
    })),
  };
}

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

    const result = await sendPrelimDeliveryEmail(
      orderId,
      normalizeReviewedRecipients(parsedBody.data, currentResolution.to),
    );

    return NextResponse.json({
      success: true,
      sent: true,
      messageId: result.messageId,
      testMode: result.testMode,
      sentTo: result.sentTo,
      sentCc: result.sentCc,
      intendedRecipients: result.intendedRecipients,
      from: result.from,
      replyTo: result.replyTo,
      subject: result.subject,
      attachment: result.attachment,
      warnings: result.resolvedRecipients.warnings,
    });
  } catch (err) {
    if (err instanceof Error && err.message === PRELIM_DELIVERY_NOT_ARMED) {
      return NextResponse.json({ error: PRELIM_DELIVERY_NOT_ARMED }, { status: 409 });
    }

    return NextResponse.json(
      { error: 'Prelim delivery failed', detail: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 },
    );
  }
}
