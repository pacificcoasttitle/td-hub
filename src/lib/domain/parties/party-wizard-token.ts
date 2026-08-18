import crypto from 'node:crypto';
import { timingSafeEqualString } from '@/lib/security/softpro-webhook-auth';

// ─── Party wizard link tokens ────────────────────────────────────────────────
//
// Construction mirrors src/lib/domain/documents/softpro-fetch-token.ts —
// HMAC-SHA256, constant-time compare, fails closed. Two deliberate differences:
//
//  1. DEDICATED SECRET, NO FALLBACK. The doc-fetch helper falls back to
//     JOB_RUNNER_SECRET; this one does not. A fallback would mean one leaked
//     secret opens both document reads and party writes — different trust
//     boundaries, so they get different keys. Unset => throw, never sign.
//
//  2. DB-BACKED. The signature proves the token was minted by us; it cannot
//     express revocation, single-use, or a rate limit. Those live on the
//     party_wizard_links row, so verification is HMAC *then* row state.
//
// The token carries NO contact data — only an opaque id. A token that leaks
// reveals nothing about the party by itself.

/** Orders run long; a link may sit in an inbox for weeks before it is opened. */
export const PARTY_WIZARD_TTL_DAYS = 60;

/** Public id length in hex chars (16 bytes). Fits the varchar(32) column. */
const TOKEN_ID_BYTES = 16;
/** Secret half, base64url. Never stored — only its SHA-256 digest is. */
const TOKEN_SECRET_BYTES = 24;
const SIG_LENGTH = 22;

export interface MintedToken {
  /** Public id, stored plainly and safe to log. */
  tokenId: string;
  /** SHA-256 of the secret half, for the token_hash column. */
  tokenHash: string;
  /** The full token for the URL. Hand to the recipient; never persist. */
  token: string;
  expiresAt: Date;
}

/**
 * Dedicated secret only. No fallback — see note 1 above.
 * @throws if unset, so a misconfigured deploy cannot mint forgeable links.
 */
export function getPartyWizardSecret(): string {
  const secret = process.env.PARTY_WIZARD_TOKEN_SECRET?.trim();
  if (secret) return secret;
  throw new Error(
    'Missing PARTY_WIZARD_TOKEN_SECRET. Party wizard links are fail-closed; no fallback secret is used.',
  );
}

function getAppBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? 'https://hub.pctitle.com').replace(/\/+$/, '');
}

function signPayload(tokenId: string, secretHalf: string): string {
  return crypto
    .createHmac('sha256', getPartyWizardSecret())
    .update(`${tokenId}.${secretHalf}`)
    .digest('base64url')
    .slice(0, SIG_LENGTH);
}

export function hashTokenSecret(secretHalf: string): string {
  return crypto.createHash('sha256').update(secretHalf).digest('hex');
}

/**
 * Mint a link token. Returns the pieces to persist plus the full token, which
 * is the only moment the secret half exists in cleartext.
 */
export function mintPartyWizardToken(ttlDays = PARTY_WIZARD_TTL_DAYS): MintedToken {
  const tokenId = crypto.randomBytes(TOKEN_ID_BYTES).toString('hex');
  const secretHalf = crypto.randomBytes(TOKEN_SECRET_BYTES).toString('base64url');
  const sig = signPayload(tokenId, secretHalf);

  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);

  return {
    tokenId,
    tokenHash: hashTokenSecret(secretHalf),
    token: `${tokenId}.${secretHalf}.${sig}`,
    expiresAt,
  };
}

export function buildPartyWizardUrl(token: string): string {
  return `${getAppBaseUrl()}/party-wizard/${token}`;
}

export interface ParsedToken {
  tokenId: string;
  secretHalf: string;
  sig: string;
}

/**
 * Parse and verify the HMAC. This is the cheap gate — it proves we minted the
 * token, and runs before any database work so a forged token costs one hash.
 *
 * It does NOT prove the link is usable: revocation, expiry and rate limits are
 * row state and are checked by the service layer.
 */
export function verifyPartyWizardToken(
  token: string,
): { ok: true; parsed: ParsedToken } | { ok: false; error: string } {
  if (typeof token !== 'string' || token.length < 32 || token.length > 200) {
    return { ok: false, error: 'Invalid link' };
  }

  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, error: 'Invalid link' };

  const [tokenId, secretHalf, sig] = parts;
  if (!/^[0-9a-f]{32}$/.test(tokenId)) return { ok: false, error: 'Invalid link' };
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(secretHalf)) return { ok: false, error: 'Invalid link' };
  if (sig.length !== SIG_LENGTH) return { ok: false, error: 'Invalid link' };

  let expected: string;
  try {
    expected = signPayload(tokenId, secretHalf);
  } catch {
    // Secret unset. Fail closed rather than letting anything through.
    return { ok: false, error: 'Server misconfigured' };
  }

  if (!timingSafeEqualString(sig, expected)) {
    return { ok: false, error: 'Invalid link' };
  }

  return { ok: true, parsed: { tokenId, secretHalf, sig } };
}

/** Constant-time check of the presented secret against the stored digest. */
export function matchesStoredHash(secretHalf: string, storedHash: string): boolean {
  return timingSafeEqualString(hashTokenSecret(secretHalf), storedHash);
}
