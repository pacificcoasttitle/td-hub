import crypto from 'node:crypto';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { ingestEvents, insertValues } = vi.hoisted(() => ({
  ingestEvents: vi.fn(),
  insertValues: vi.fn(),
}));

vi.mock('@/lib/domain/notifications/email-events', async () => {
  const actual = await vi.importActual<typeof import('@/lib/domain/notifications/email-events')>(
    '@/lib/domain/notifications/email-events',
  );
  return { ...actual, ingestEvents };
});

// The log write must never be the reason a batch is lost, so it is recorded
// and allowed to fail.
vi.mock('@/lib/db/client', () => ({
  db: { insert: () => ({ values: insertValues }) },
}));

const { POST } = await import('./route');

const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const SPKI = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

function post(body: string, opts: { sign?: boolean; timestamp?: string } = {}) {
  const timestamp = opts.timestamp ?? String(Math.floor(Date.now() / 1000));
  const headers = new Headers({ 'content-type': 'application/json' });
  if (opts.sign !== false) {
    headers.set('x-twilio-email-event-webhook-timestamp', timestamp);
    headers.set(
      'x-twilio-email-event-webhook-signature',
      crypto.sign('sha256', Buffer.from(timestamp + body, 'utf8'), { key: privateKey, dsaEncoding: 'der' }).toString('base64'),
    );
  }
  return POST(new NextRequest('http://localhost/api/webhooks/sendgrid/events', { method: 'POST', body, headers }));
}

const BATCH = JSON.stringify([
  { sg_message_id: 'ours.filterdrecv-1.0', email: 'rep@pct.com', event: 'delivered', timestamp: 1758500000 },
]);

beforeEach(() => {
  process.env.SENDGRID_WEBHOOK_PUBLIC_KEY = SPKI;
  ingestEvents.mockReset();
  insertValues.mockReset();
  ingestEvents.mockResolvedValue({ received: 1, kept: 1, unmatched: 0, duplicates: 0, unusable: 0, updated: 1 });
  insertValues.mockResolvedValue(undefined);
});

describe('a genuine batch from SendGrid', () => {
  it('is accepted and handed on', async () => {
    const res = await post(BATCH);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, kept: 1, updated: 1 });
    expect(ingestEvents).toHaveBeenCalledTimes(1);
  });

  it('verifies the RAW body, not a re-serialised copy', async () => {
    // A body whose key order differs from any re-serialisation. If the route
    // ever verifies JSON.stringify(parsed) instead of the bytes, this fails.
    const body = '[{"timestamp":1758500000,"event":"bounce","sg_message_id":"x.y","email":"a@b.com"}]';
    expect((await post(body)).status).toBe(200);
  });
});

describe('a batch we cannot authenticate', () => {
  it('is refused, and never reaches the ingest', async () => {
    const res = await post(BATCH, { sign: false });
    expect(res.status).toBe(401);
    expect(ingestEvents).not.toHaveBeenCalled();
  });

  it('is refused when the body was altered after signing', async () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const headers = new Headers({
      'x-twilio-email-event-webhook-timestamp': timestamp,
      'x-twilio-email-event-webhook-signature': crypto
        .sign('sha256', Buffer.from(timestamp + BATCH, 'utf8'), { key: privateKey, dsaEncoding: 'der' })
        .toString('base64'),
    });
    const tampered = JSON.stringify([{ sg_message_id: 'ours.1', email: 'x@y.com', event: 'delivered', timestamp: 1 }]);
    const res = await POST(new NextRequest('http://localhost/api/webhooks/sendgrid/events', { method: 'POST', body: tampered, headers }));
    expect(res.status).toBe(401);
    expect(ingestEvents).not.toHaveBeenCalled();
  });

  it('is refused when no public key is configured — never waved through', async () => {
    delete process.env.SENDGRID_WEBHOOK_PUBLIC_KEY;
    expect((await post(BATCH)).status).toBe(401);
    expect(ingestEvents).not.toHaveBeenCalled();
  });

  it('records the rejection, so a key rotation that breaks this is visible', async () => {
    await post(BATCH, { sign: false });
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
      vendor: 'sendgrid', operation: 'sendgrid_events_rejected', success: false,
    }));
  });
});

describe('a batch that is signed but malformed', () => {
  it('rejects non-JSON without asking for a retry', async () => {
    const res = await post('not json at all');
    expect(res.status).toBe(400);
  });

  it('rejects a JSON object where an array belongs', async () => {
    const res = await post(JSON.stringify({ event: 'delivered' }));
    expect(res.status).toBe(400);
    expect(ingestEvents).not.toHaveBeenCalled();
  });

  it('accepts an empty batch without complaint', async () => {
    ingestEvents.mockResolvedValue({ received: 0, kept: 0, unmatched: 0, duplicates: 0, unusable: 0, updated: 0 });
    expect((await post('[]')).status).toBe(200);
  });
});

describe('when we cannot store the batch', () => {
  it('answers 500 so SendGrid retries it', async () => {
    // A 200 here loses the batch for good — the precise failure this endpoint
    // exists to end. The database being down must not silence a bounce.
    ingestEvents.mockRejectedValue(new Error('connection refused'));
    const res = await post(BATCH);
    expect(res.status).toBe(500);
  });

  it('still answers 200 when only the audit log write fails', async () => {
    // Logging is not the job. Losing the batch because the log failed would
    // be the tail wagging the dog.
    insertValues.mockRejectedValue(new Error('log table is full'));
    expect((await post(BATCH)).status).toBe(200);
  });
});
