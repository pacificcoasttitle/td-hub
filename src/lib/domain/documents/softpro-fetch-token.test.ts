import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { softProDocumentName } from './softpro-document-name';
import {
  buildSoftProFetchUrl,
  getSoftProDocFetchSecret,
  verifySoftProFetchToken,
} from './softpro-fetch-token';

const ENV_KEYS = [
  'SOFTPRO_DOC_FETCH_SECRET',
  'SOFTPRO_WEBHOOK_SECRET',
  'JOB_RUNNER_SECRET',
  'NEXT_PUBLIC_APP_URL',
] as const;

const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

function restoreEnv() {
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function clearSigningSecrets() {
  delete process.env.SOFTPRO_DOC_FETCH_SECRET;
  delete process.env.SOFTPRO_WEBHOOK_SECRET;
  delete process.env.JOB_RUNNER_SECRET;
}

describe('softProDocumentName', () => {
  it('keeps SoftPro DocumentName short', () => {
    expect(softProDocumentName({
      documentId: 3346,
      category: 'grant_deed',
      filename: 'tp_20018618-GLT_grant_deed_1780952663434.pdf',
    })).toBe('gd-3346.pdf');
  });
});

describe('softPro fetch token', () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
    }
  });

  afterEach(() => {
    restoreEnv();
  });

  it('signs and verifies short SoftPro fetch URLs under MAX_PATH pressure', () => {
    clearSigningSecrets();
    process.env.SOFTPRO_DOC_FETCH_SECRET = 'test-secret';
    process.env.NEXT_PUBLIC_APP_URL = 'https://hub.pctitle.com';

    const url = buildSoftProFetchUrl(3346);
    expect(url.length).toBeLessThan(200);
    const parts = url.split('/');
    const sig = parts.pop()!;
    const exp = Number(parts.pop());
    const documentId = Number(parts.pop());
    expect(verifySoftProFetchToken(documentId, exp, sig)).toEqual({ ok: true });
    expect(verifySoftProFetchToken(documentId, exp, 'bad-signature-value!!!!').ok).toBe(false);
  });

  it('falls back to JOB_RUNNER_SECRET when dedicated secret is unset', () => {
    clearSigningSecrets();
    process.env.JOB_RUNNER_SECRET = 'runner-only-secret';
    process.env.NEXT_PUBLIC_APP_URL = 'https://hub.pctitle.com';

    expect(getSoftProDocFetchSecret()).toBe('runner-only-secret');
    const url = buildSoftProFetchUrl(10);
    const parts = url.split('/');
    const sig = parts.pop()!;
    const exp = Number(parts.pop());
    expect(verifySoftProFetchToken(10, exp, sig)).toEqual({ ok: true });
  });

  it('never uses SOFTPRO_WEBHOOK_SECRET for fetch-doc signing', () => {
    clearSigningSecrets();
    process.env.SOFTPRO_WEBHOOK_SECRET = 'webhook-secret-must-not-sign';
    process.env.NEXT_PUBLIC_APP_URL = 'https://hub.pctitle.com';

    expect(() => getSoftProDocFetchSecret()).toThrow(/SOFTPRO_DOC_FETCH_SECRET/);
    expect(() => buildSoftProFetchUrl(42)).toThrow(/fail-closed/i);

    // Even if an attacker presents a token shaped like a valid sig, verify fails closed
    // because no allowed signing secret is configured (webhook alone is ignored).
    expect(verifySoftProFetchToken(42, Math.floor(Date.now() / 1000) + 3600, 'a'.repeat(22))).toEqual({
      ok: false,
      error: 'Server misconfigured',
    });
  });

  it('prefers SOFTPRO_DOC_FETCH_SECRET over JOB_RUNNER_SECRET and ignores webhook', () => {
    clearSigningSecrets();
    process.env.SOFTPRO_DOC_FETCH_SECRET = 'dedicated-secret';
    process.env.JOB_RUNNER_SECRET = 'runner-secret';
    process.env.SOFTPRO_WEBHOOK_SECRET = 'webhook-secret';

    expect(getSoftProDocFetchSecret()).toBe('dedicated-secret');
  });
});
