import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  signSoftProWebhookBody,
  softProWebhookUnauthorizedResponse,
  timingSafeEqualString,
  verifySoftProWebhookRequest,
} from './softpro-webhook-auth';

const SECRET = 'test-webhook-secret-value';

describe('timingSafeEqualString', () => {
  it('returns true for equal strings', () => {
    expect(timingSafeEqualString('abc', 'abc')).toBe(true);
  });

  it('returns false for unequal strings', () => {
    expect(timingSafeEqualString('abc', 'abd')).toBe(false);
    expect(timingSafeEqualString('abc', 'ab')).toBe(false);
  });
});

describe('verifySoftProWebhookRequest', () => {
  beforeEach(() => {
    process.env.SOFTPRO_WEBHOOK_SECRET = SECRET;
  });

  afterEach(() => {
    delete process.env.SOFTPRO_WEBHOOK_SECRET;
  });

  it('accepts a valid HMAC signature header', () => {
    const rawBody = '{"OrderNumber":"123"}';
    const headers = new Headers({
      'x-softpro-signature': signSoftProWebhookBody(rawBody, SECRET),
    });

    expect(verifySoftProWebhookRequest(headers, rawBody)).toEqual({ ok: true });
  });

  it('accepts a valid Bearer shared secret', () => {
    const headers = new Headers({
      authorization: `Bearer ${SECRET}`,
    });

    expect(verifySoftProWebhookRequest(headers, '{}')).toEqual({ ok: true });
  });

  it('rejects when signature is missing', () => {
    expect(verifySoftProWebhookRequest(new Headers(), '{}')).toEqual({
      ok: false,
      reason: 'missing_signature',
    });
  });

  it('rejects an invalid HMAC signature', () => {
    const headers = new Headers({
      'x-softpro-signature': 'sha256=deadbeef',
    });

    expect(verifySoftProWebhookRequest(headers, '{"OrderNumber":"123"}')).toEqual({
      ok: false,
      reason: 'invalid_signature',
    });
  });

  it('rejects an invalid Bearer token', () => {
    const headers = new Headers({
      authorization: 'Bearer wrong-secret',
    });

    expect(verifySoftProWebhookRequest(headers, '{}')).toEqual({
      ok: false,
      reason: 'invalid_signature',
    });
  });

  it('fail-closes when SOFTPRO_WEBHOOK_SECRET is not configured', () => {
    delete process.env.SOFTPRO_WEBHOOK_SECRET;
    const headers = new Headers({
      authorization: `Bearer ${SECRET}`,
    });

    expect(verifySoftProWebhookRequest(headers, '{}')).toEqual({
      ok: false,
      reason: 'secret_not_configured',
    });
  });

  it('returns 401 for unauthorized responses', async () => {
    const response = softProWebhookUnauthorizedResponse('invalid_signature');
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid webhook signature' });
  });
});

describe('verifySoftProWebhookRequest logging helper contract', () => {
  it('does not throw when env is empty string', () => {
    process.env.SOFTPRO_WEBHOOK_SECRET = '';
    expect(verifySoftProWebhookRequest(new Headers(), '{}')).toEqual({
      ok: false,
      reason: 'secret_not_configured',
    });
    delete process.env.SOFTPRO_WEBHOOK_SECRET;
  });
});
