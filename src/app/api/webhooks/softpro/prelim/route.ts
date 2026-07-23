import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { vendorApiLogs } from '@/lib/db/schema';
import {
  prelimPayloadSchema,
  handlePrelimWebhook,
} from '@/lib/domain/webhooks/softpro-handler';
import {
  logSoftProWebhookRejection,
  softProWebhookUnauthorizedResponse,
  verifySoftProWebhookRequest,
} from '@/lib/security/softpro-webhook-auth';

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  const startedAt = new Date();

  const rawBodyText = await req.text();
  const auth = verifySoftProWebhookRequest(req.headers, rawBodyText);
  if (!auth.ok) {
    logSoftProWebhookRejection('/api/webhooks/softpro/prelim', auth.reason);
    await logWebhook(requestId, startedAt, 'webhook_prelim_auth_rejected', null, false, auth.reason);
    return softProWebhookUnauthorizedResponse(auth.reason);
  }

  let rawBody: unknown;
  try {
    rawBody = JSON.parse(rawBodyText);
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' });
  }

  await logWebhook(requestId, startedAt, 'webhook_prelim_received', rawBody);

  const parsed = prelimPayloadSchema.safeParse(rawBody);
  if (!parsed.success) {
    await logWebhook(requestId, startedAt, 'webhook_prelim_invalid', rawBody, false, parsed.error.message);
    return NextResponse.json({ success: false, error: 'Invalid payload', details: parsed.error.issues });
  }

  try {
    const result = await handlePrelimWebhook(parsed.data);
    await logWebhook(requestId, startedAt, 'webhook_prelim_processed', rawBody, result.success, undefined, result);
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    await logWebhook(requestId, startedAt, 'webhook_prelim_error', rawBody, false, msg);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

/** Must match admin SP Webhooks view filter (`/api/webhooks/log` → softpro_webhook). */
const WEBHOOK_VENDOR = 'softpro_webhook';

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
      vendor: WEBHOOK_VENDOR,
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
