import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  MAX_SKEW_SECONDS, toPem, verifySendGridWebhook,
} from './sendgrid-webhook-auth';

// Real P-256 keys and real signatures. Mocking the crypto would leave the one
// thing this file exists to prove — that a forged batch is refused — asserted
// against a stub that always agrees.
const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const OTHER = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });

const spki = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const now = new Date('2026-09-22T12:00:00Z');
const ts = String(Math.floor(now.getTime() / 1000));

function sign(body: string, timestamp = ts, key = privateKey): string {
  return crypto
    .sign('sha256', Buffer.from(timestamp + body, 'utf8'), { key, dsaEncoding: 'der' })
    .toString('base64');
}

const BODY = JSON.stringify([{ email: 'a@b.com', event: 'delivered', sg_message_id: 'abc.123' }]);

const verify = (o: Partial<Parameters<typeof verifySendGridWebhook>[0]> = {}) =>
  verifySendGridWebhook({
    rawBody: BODY, signature: sign(BODY), timestamp: ts, now, publicKey: spki, ...o,
  });

describe('a genuine batch', () => {
  it('verifies', () => {
    expect(verify()).toEqual({ ok: true });
  });

  it('verifies when the key is pasted as PEM rather than bare base64', () => {
    const pem = publicKey.export({ type: 'spki', format: 'pem' }) as string;
    expect(verify({ publicKey: pem })).toEqual({ ok: true });
  });

  it('accepts a timestamp at the edge of the window', () => {
    const edge = new Date(now.getTime() + (MAX_SKEW_SECONDS - 1) * 1000);
    expect(verify({ now: edge })).toEqual({ ok: true });
  });
});

describe('a batch that is not what it claims', () => {
  it('refuses a body altered after signing — the whole point', () => {
    const tampered = JSON.stringify([{ email: 'a@b.com', event: 'delivered', sg_message_id: 'evil' }]);
    expect(verify({ rawBody: tampered })).toEqual({ ok: false, reason: 'invalid_signature' });
  });

  it('refuses a signature from a different key', () => {
    expect(verify({ signature: sign(BODY, ts, OTHER.privateKey) }))
      .toEqual({ ok: false, reason: 'invalid_signature' });
  });

  it('refuses a replay of a genuine old batch', () => {
    // The signature stays valid forever; only the clock refuses it.
    const later = new Date(now.getTime() + (MAX_SKEW_SECONDS + 60) * 1000);
    expect(verify({ now: later })).toEqual({ ok: false, reason: 'stale_timestamp' });
  });

  it('refuses a timestamp moved to dodge the skew check', () => {
    // Moving the timestamp invalidates the signature, because the timestamp is
    // part of what was signed.
    const fresh = String(Math.floor(now.getTime() / 1000));
    expect(verify({ timestamp: fresh, signature: sign(BODY, '1') }))
      .toEqual({ ok: false, reason: 'invalid_signature' });
  });

  it('refuses garbage where the signature should be', () => {
    expect(verify({ signature: 'not-base64-at-all!!' })).toEqual({ ok: false, reason: 'invalid_signature' });
  });
});

describe('a batch we cannot check at all', () => {
  // Every one of these must be a refusal. An endpoint that waves a batch
  // through when it cannot verify it is an unauthenticated writer to the
  // table that decides whether anyone is told a client's report bounced.
  it('refuses when no public key is configured', () => {
    expect(verify({ publicKey: null })).toEqual({ ok: false, reason: 'public_key_not_configured' });
  });

  it('refuses when the key is configured as whitespace', () => {
    expect(verify({ publicKey: '   ' })).toEqual({ ok: false, reason: 'public_key_not_configured' });
  });

  it('refuses a missing signature header', () => {
    expect(verify({ signature: null })).toEqual({ ok: false, reason: 'missing_signature' });
  });

  it('refuses a missing timestamp header', () => {
    expect(verify({ timestamp: null })).toEqual({ ok: false, reason: 'missing_timestamp' });
  });

  it('refuses a timestamp that is not a number', () => {
    expect(verify({ timestamp: 'yesterday' })).toEqual({ ok: false, reason: 'bad_timestamp' });
  });

  it('refuses a malformed public key rather than throwing', () => {
    expect(verify({ publicKey: 'AAAA' })).toEqual({ ok: false, reason: 'invalid_signature' });
  });
});

describe('toPem', () => {
  it('wraps bare base64 into PEM at 64-character lines', () => {
    const pem = toPem(spki);
    expect(pem.startsWith('-----BEGIN PUBLIC KEY-----\n')).toBe(true);
    expect(pem.trimEnd().endsWith('-----END PUBLIC KEY-----')).toBe(true);
    for (const line of pem.split('\n').slice(1, -2)) expect(line.length).toBeLessThanOrEqual(64);
  });

  it('leaves an already-armoured key alone', () => {
    const pem = publicKey.export({ type: 'spki', format: 'pem' }) as string;
    expect(toPem(pem)).toBe(pem.trim());
  });
});
