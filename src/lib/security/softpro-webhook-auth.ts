import crypto from 'node:crypto';
import { NextResponse } from 'next/server';

export const SOFTPRO_WEBHOOK_SIGNATURE_HEADER = 'x-softpro-signature';
export const SOFTPRO_WEBHOOK_SECRET_ENV = 'SOFTPRO_WEBHOOK_SECRET';

export type SoftProWebhookAuthFailureReason =
  | 'secret_not_configured'
  | 'missing_signature'
  | 'invalid_signature';

export type SoftProWebhookAuthResult =
  | { ok: true }
  | { ok: false; reason: SoftProWebhookAuthFailureReason };

/**
 * Constant-time string compare. Length mismatch returns false after a
 * dummy compare so timing does not short-circuit on length alone.
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    crypto.timingSafeEqual(aBuf, aBuf);
    return false;
  }
  try {
    return crypto.timingSafeEqual(aBuf, bBuf);
  } catch {
    return false;
  }
}

function readWebhookSecret(): string | null {
  const secret = process.env[SOFTPRO_WEBHOOK_SECRET_ENV];
  if (typeof secret !== 'string' || secret.length === 0) return null;
  return secret;
}

function extractBearerToken(authorization: string | null): string | null {
  if (!authorization) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return match?.[1]?.trim() || null;
}

function normalizeSignatureHeader(value: string): string {
  const trimmed = value.trim();
  if (trimmed.toLowerCase().startsWith('sha256=')) {
    return trimmed.slice('sha256='.length).trim().toLowerCase();
  }
  return trimmed.toLowerCase();
}

function expectedHmacHex(secret: string, rawBody: string): string {
  return crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
}

/**
 * Verify SoftPro webhook authenticity.
 *
 * Fail-closed: if SOFTPRO_WEBHOOK_SECRET is unset, every request is rejected.
 *
 * Accepted credentials (either is enough):
 * - Authorization: Bearer <SOFTPRO_WEBHOOK_SECRET>
 * - X-SoftPro-Signature: sha256=<hex>  (HMAC-SHA256 of raw body)
 */
export function verifySoftProWebhookRequest(
  headers: Headers,
  rawBody: string,
): SoftProWebhookAuthResult {
  const secret = readWebhookSecret();
  if (!secret) {
    return { ok: false, reason: 'secret_not_configured' };
  }

  const bearer = extractBearerToken(headers.get('authorization'));
  const signatureHeader = headers.get(SOFTPRO_WEBHOOK_SIGNATURE_HEADER);

  if (!bearer && !signatureHeader) {
    return { ok: false, reason: 'missing_signature' };
  }

  if (bearer && timingSafeEqualString(bearer, secret)) {
    return { ok: true };
  }

  if (signatureHeader) {
    const provided = normalizeSignatureHeader(signatureHeader);
    const expected = expectedHmacHex(secret, rawBody);
    if (timingSafeEqualString(provided, expected)) {
      return { ok: true };
    }
  }

  return { ok: false, reason: 'invalid_signature' };
}

export function softProWebhookUnauthorizedResponse(
  reason: SoftProWebhookAuthFailureReason,
): NextResponse {
  const message =
    reason === 'secret_not_configured'
      ? 'Webhook secret not configured'
      : reason === 'missing_signature'
        ? 'Missing webhook signature'
        : 'Invalid webhook signature';

  return NextResponse.json({ error: message }, { status: 401 });
}

export function logSoftProWebhookRejection(
  path: string,
  reason: SoftProWebhookAuthFailureReason,
): void {
  console.warn('[softpro-webhook] rejected request', { path, reason });
}

/** Sign a raw body for tests / adapter docs. */
export function signSoftProWebhookBody(rawBody: string, secret: string): string {
  return `sha256=${expectedHmacHex(secret, rawBody)}`;
}
