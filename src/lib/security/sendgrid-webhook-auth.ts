import crypto from 'node:crypto';

/**
 * ─── Verifying that an event batch really came from SendGrid ────────────────
 *
 * This endpoint is public — it has to be, SendGrid calls it — and it writes
 * to a table that decides whether a human is told "your client never got
 * their title report". An unauthenticated writer could silence a real bounce
 * by asserting `delivered`, which is worse than not having the webhook.
 *
 * SendGrid does NOT sign the way SoftPro does. SoftPro is an HMAC with a
 * shared secret; SendGrid is ECDSA over the P-256 curve, and we hold only the
 * PUBLIC key. That is strictly better here: the key in our environment cannot
 * be used to forge a request, so leaking it costs nothing.
 *
 * The signed payload is the timestamp header CONCATENATED WITH THE RAW BODY,
 * byte for byte. It must be the raw body and not a re-serialised object —
 * `JSON.stringify(await req.json())` reorders nothing today and will reorder
 * something one day, and every signature would fail with no clue why.
 */

export const SIGNATURE_HEADER = 'x-twilio-email-event-webhook-signature';
export const TIMESTAMP_HEADER = 'x-twilio-email-event-webhook-timestamp';
export const PUBLIC_KEY_ENV = 'SENDGRID_WEBHOOK_PUBLIC_KEY';

/**
 * How far out of step with SendGrid's clock a batch may be. Replay protection:
 * without it, a batch captured once could be replayed forever, and its
 * signature would stay valid because the signature covers only the timestamp
 * and body.
 *
 * Ten minutes is SendGrid's own suggestion and is generous enough to survive
 * their retries and our clock drift.
 */
export const MAX_SKEW_SECONDS = 600;

export type VerifyFailure =
  | 'public_key_not_configured'
  | 'missing_signature'
  | 'missing_timestamp'
  | 'bad_timestamp'
  | 'stale_timestamp'
  | 'invalid_signature';

export type VerifyResult = { ok: true } | { ok: false; reason: VerifyFailure };

/**
 * SendGrid shows the key as bare base64 DER (SPKI), without the PEM armour
 * Node wants. Accept it either way, so whoever sets the variable can paste
 * what the dashboard gives them.
 */
export function toPem(key: string): string {
  const trimmed = key.trim();
  if (trimmed.includes('BEGIN PUBLIC KEY')) return trimmed;
  const body = trimmed.replace(/\s+/g, '').match(/.{1,64}/g)?.join('\n') ?? '';
  return `-----BEGIN PUBLIC KEY-----\n${body}\n-----END PUBLIC KEY-----\n`;
}

export function verifySendGridWebhook(params: {
  rawBody: string;
  signature: string | null;
  timestamp: string | null;
  /** Injected so the skew check is testable without touching the clock. */
  now?: Date;
  publicKey?: string | null;
}): VerifyResult {
  const key = params.publicKey ?? process.env[PUBLIC_KEY_ENV] ?? null;
  // Refuse rather than accept. An endpoint that waves everything through when
  // a variable is unset is how an unverified webhook reaches production and
  // looks like it is working.
  if (!key || key.trim().length === 0) return { ok: false, reason: 'public_key_not_configured' };
  if (!params.signature) return { ok: false, reason: 'missing_signature' };
  if (!params.timestamp) return { ok: false, reason: 'missing_timestamp' };

  const seconds = Number(params.timestamp);
  if (!Number.isFinite(seconds)) return { ok: false, reason: 'bad_timestamp' };

  const now = params.now ?? new Date();
  const skew = Math.abs(now.getTime() / 1000 - seconds);
  if (skew > MAX_SKEW_SECONDS) return { ok: false, reason: 'stale_timestamp' };

  try {
    const verified = crypto.verify(
      'sha256',
      Buffer.from(params.timestamp + params.rawBody, 'utf8'),
      // SendGrid signs with ECDSA and encodes the signature DER, base64.
      { key: crypto.createPublicKey(toPem(key)), dsaEncoding: 'der' },
      Buffer.from(params.signature, 'base64'),
    );
    return verified ? { ok: true } : { ok: false, reason: 'invalid_signature' };
  } catch {
    // A malformed key or signature is a failure to verify, not a crash, and
    // certainly not a pass.
    return { ok: false, reason: 'invalid_signature' };
  }
}
