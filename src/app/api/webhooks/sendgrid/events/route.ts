import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { vendorApiLogs } from '@/lib/db/schema';
import { ingestEvents, type SendGridEvent } from '@/lib/domain/notifications/email-events';
import {
  SIGNATURE_HEADER, TIMESTAMP_HEADER, verifySendGridWebhook,
} from '@/lib/security/sendgrid-webhook-auth';

/**
 * ─── SendGrid's event webhook ───────────────────────────────────────────────
 *
 * The thing that makes a bounce visible. Until this existed, a message
 * SendGrid accepted and then failed to deliver was invisible: seventeen of
 * them went out between April and September, six of them prelims, and every
 * screen said Sent.
 *
 * Point SendGrid's Event Webhook at this URL, with signature verification
 * switched on, and set SENDGRID_WEBHOOK_PUBLIC_KEY to the key it shows.
 *
 * ON ANSWERING 200
 *   SendGrid retries a batch it could not deliver, which is what we want when
 *   the database is down: answering 200 to a batch we failed to store would
 *   lose it for good. So a storage failure returns 500 and takes the retry.
 *   A batch we cannot AUTHENTICATE returns 401 and must not be retried.
 */

// The raw bytes are what was signed; Next must not re-serialise them.
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const startedAt = new Date();
  const rawBody = await req.text();

  const auth = verifySendGridWebhook({
    rawBody,
    signature: req.headers.get(SIGNATURE_HEADER),
    timestamp: req.headers.get(TIMESTAMP_HEADER),
  });

  if (!auth.ok) {
    // Logged, because a run of these is either a misconfiguration after a key
    // rotation or somebody trying to write to this table. Both want noticing.
    await log(startedAt, 'sendgrid_events_rejected', false, { reason: auth.reason }, auth.reason);
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let batch: unknown;
  try {
    batch = JSON.parse(rawBody);
  } catch {
    // Signed by SendGrid and still not JSON: keep it, do not retry it.
    await log(startedAt, 'sendgrid_events_unparseable', false, { bytes: rawBody.length }, 'invalid_json');
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!Array.isArray(batch)) {
    await log(startedAt, 'sendgrid_events_unparseable', false, { shape: typeof batch }, 'not_an_array');
    return NextResponse.json({ error: 'Expected an array of events' }, { status: 400 });
  }

  try {
    const result = await ingestEvents(batch as SendGridEvent[]);
    await log(startedAt, 'sendgrid_events_processed', true, { ...result });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    await log(startedAt, 'sendgrid_events_failed', false, { count: batch.length }, message);
    // 500 so SendGrid retries. A 200 here would drop the batch silently, which
    // is the exact failure this endpoint exists to end.
    return NextResponse.json({ error: 'Could not store events' }, { status: 500 });
  }
}

async function log(
  startedAt: Date,
  operation: string,
  success: boolean,
  meta: Record<string, unknown>,
  errorCategory?: string,
) {
  try {
    await db.insert(vendorApiLogs).values({
      vendor: 'sendgrid',
      operation,
      requestId: crypto.randomUUID(),
      startedAt,
      endedAt: new Date(),
      success,
      errorCategory: errorCategory ?? null,
      responseMeta: meta,
    });
  } catch { /* logging must never be the reason a batch is lost */ }
}
