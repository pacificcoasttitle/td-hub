import crypto from 'node:crypto';
import { timingSafeEqualString } from '@/lib/security/softpro-webhook-auth';

/** SoftPro downloads FileURL; keep the absolute URL well under Windows MAX_PATH (260). */
export const SOFTPRO_FETCH_TTL_SECONDS = 60 * 60; // 1 hour

/**
 * Dedicated door secret only — never reuse SOFTPRO_WEBHOOK_SECRET (different trust boundary).
 * Fallback: JOB_RUNNER_SECRET. If neither is set, fail closed (no signing).
 */
export function getSoftProDocFetchSecret(): string {
  const dedicated = process.env.SOFTPRO_DOC_FETCH_SECRET?.trim();
  if (dedicated) return dedicated;

  const jobRunner = process.env.JOB_RUNNER_SECRET?.trim();
  if (jobRunner) return jobRunner;

  throw new Error(
    'Missing SOFTPRO_DOC_FETCH_SECRET (or JOB_RUNNER_SECRET fallback). SoftPro fetch-doc is fail-closed.',
  );
}

function getFetchSecret(): string {
  return getSoftProDocFetchSecret();
}

function getAppBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? 'https://hub.pctitle.com').replace(/\/+$/, '');
}

function signPayload(documentId: number, expUnix: number): string {
  return crypto
    .createHmac('sha256', getFetchSecret())
    .update(`${documentId}.${expUnix}`)
    .digest('base64url')
    .slice(0, 22);
}

/**
 * Build a short, publicly reachable URL SoftPro can download.
 * SoftPro fails with Windows MAX_PATH when given long pre-signed S3 URLs (~440+ chars).
 */
export function buildSoftProFetchUrl(documentId: number, ttlSeconds = SOFTPRO_FETCH_TTL_SECONDS): string {
  const expUnix = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = signPayload(documentId, expUnix);
  return `${getAppBaseUrl()}/api/softpro/fetch-doc/${documentId}/${expUnix}/${sig}`;
}

export function verifySoftProFetchToken(
  documentId: number,
  expUnix: number,
  sig: string,
): { ok: true } | { ok: false; error: string } {
  if (!Number.isFinite(documentId) || documentId <= 0) {
    return { ok: false, error: 'Invalid document id' };
  }
  if (!Number.isFinite(expUnix) || expUnix <= 0) {
    return { ok: false, error: 'Invalid expiry' };
  }
  if (typeof sig !== 'string' || sig.length < 16) {
    return { ok: false, error: 'Invalid signature' };
  }
  if (Math.floor(Date.now() / 1000) > expUnix) {
    return { ok: false, error: 'Token expired' };
  }
  let expected: string;
  try {
    expected = signPayload(documentId, expUnix);
  } catch {
    return { ok: false, error: 'Server misconfigured' };
  }
  if (!timingSafeEqualString(sig, expected)) {
    return { ok: false, error: 'Invalid signature' };
  }
  return { ok: true };
}
