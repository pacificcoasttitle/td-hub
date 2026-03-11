import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { vendorApiLogs } from '@/lib/db/schema';
import {
  prelimPayloadSchema,
  handlePrelimWebhook,
} from '@/lib/domain/webhooks/softpro-handler';

// TODO: Add webhook signature verification once SoftPro supports auth headers

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  const startedAt = new Date();
  let rawBody: unknown;

  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' });
  }

  await logWebhook(requestId, startedAt, 'webhook_prelim_received', rawBody);

  const parsed = prelimPayloadSchema.safeParse(rawBody);
  if (!parsed.success) {
    await logWebhook(requestId, startedAt, 'webhook_prelim_invalid', rawBody, false, parsed.error.message);
    return NextResponse.json({ success: false, error: 'Invalid payload', details: parsed.error.issues });
  }

  const result = await handlePrelimWebhook(parsed.data);

  await logWebhook(requestId, startedAt, 'webhook_prelim_processed', rawBody, result.success, undefined, result);

  return NextResponse.json(result);
}

async function logWebhook(
  requestId: string,
  startedAt: Date,
  operation: string,
  body: unknown,
  success?: boolean,
  error?: string,
  result?: unknown,
) {
  try {
    await db.insert(vendorApiLogs).values({
      vendor: 'softpro',
      operation,
      requestId,
      startedAt,
      endedAt: new Date(),
      success: success ?? null,
      errorCategory: error ? 'VALIDATION' : null,
      requestMeta: { body } as Record<string, unknown>,
      responseMeta: (result ?? (error ? { error } : null)) as Record<string, unknown> | null,
    });
  } catch { /* Don't let logging failures break the webhook response */ }
}
