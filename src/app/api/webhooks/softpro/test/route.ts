import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  handlePrelimWebhook,
  handlePolicyWebhook,
  handleMilestoneWebhook,
  prelimPayloadSchema,
  policyPayloadSchema,
  milestonePayloadSchema,
} from '@/lib/domain/webhooks/softpro-handler';

const testSchema = z.object({
  type: z.enum(['prelim', 'policy', 'milestone']),
  payload: z.record(z.string(), z.unknown()),
});

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const parsed = testSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Expected { type: "prelim"|"policy"|"milestone", payload: {...} }', details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { type, payload } = parsed.data;

  try {
    if (type === 'prelim') {
      const validated = prelimPayloadSchema.parse(payload);
      const result = await handlePrelimWebhook(validated);
      return NextResponse.json({ type, result });
    }
    if (type === 'policy') {
      const validated = policyPayloadSchema.parse(payload);
      const result = await handlePolicyWebhook(validated);
      return NextResponse.json({ type, result });
    }
    const validated = milestonePayloadSchema.parse(payload);
    const result = await handleMilestoneWebhook(validated);
    return NextResponse.json({ type, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
