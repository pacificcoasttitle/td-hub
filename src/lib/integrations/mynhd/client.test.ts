import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readSource } from '@/test-support/read-source';

vi.mock('./auth', async (importOriginal) => {
  const real = await importOriginal<typeof import('./auth')>();
  return { ...real, logRequest: vi.fn(async () => {}) };
});

import { __resetTokenCacheForTests } from './auth';
import { fetchFloodFirePreview, isPng, isPreview, saysReAuth } from './client';

// ─── HTTP 200 IS NOT AN ANSWER ───────────────────────────────────────────────
//
// MyNHD reports a multi-match as HTTP 200 with `success: false` and
// `code: "multi_result"`, carrying no image and no order link. Its own guide
// says "Do not treat HTTP 200 alone as a successful preview".
//
// This is the SiteX 300 wearing the opposite status code. There, an ordinary
// answer arrived as an error status and we called it a failure for weeks —
// 14 attempts in 53 minutes on one address. Here a NON-answer arrives as a
// success status, and the failure mode is the worse direction: a profile with
// a hazard sheet on it that MyNHD never generated.

const PARCEL = { apn: '8381-021-001', fips: '06037', state: 'CA' };

/** A real one-pixel PNG, so the signature check has something valid to pass. */
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const MULTI_RESULT = JSON.stringify({
  success: false,
  code: 'multi_result',
  error: 'Preview skipped: multiple properties found for this address.',
});

let calls: Array<{ url: string; auth: string | null; body: unknown }> = [];

/** Answers the auth POST, then each preview POST from the given queue. */
function answer(...turns: Array<{ status: number; body: string }>) {
  const queue = [...turns];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).endsWith('/getAuthorizationHeader')) {
      return new Response(JSON.stringify({ token: `tok-${calls.length}` }), { status: 200 });
    }
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({
      url: String(url),
      auth: headers.Authorization ?? null,
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    const turn = queue.shift() ?? { status: 500, body: '{}' };
    return new Response(turn.body, { status: turn.status });
  }));
}

beforeEach(() => {
  calls = [];
  __resetTokenCacheForTests();
  process.env.MYNHD_SECRET_KEY = 'test-secret';
  process.env.MYNHD_BASE_URL = 'https://api.mynhd.test';
});

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('a 200 with success:false is not a preview', () => {
  it('refuses a multi_result and names it', async () => {
    answer({ status: 200, body: MULTI_RESULT });
    const r = await fetchFloodFirePreview(PARCEL);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.reason).toBe('multi_result');
    expect(r.message).toContain('more than one property');
  });

  it('keeps the vendor\'s own success, code and error as evidence', async () => {
    // Structured, not a clipped body string. The SiteX 300 investigation lost
    // the candidate count to a 400-character truncation.
    answer({ status: 200, body: MULTI_RESULT });
    const r = await fetchFloodFirePreview(PARCEL);
    expect(r.evidence).toMatchObject({
      httpStatus: 200, success: false, code: 'multi_result',
    });
    expect(r.evidence!.error).toContain('multiple properties');
  });

  it('is not rescued by a truthy success — it must be exactly true', async () => {
    // `success` is absent on most error bodies, and a truthy check would let a
    // non-empty string or a 1 through. The guide: "consider a preview
    // successful only when … success is exactly true".
    for (const success of ['true', 1, {}, [], 'yes']) {
      answer({ status: 200, body: JSON.stringify({ success, image_data: PNG_B64 }) });
      const r = await fetchFloodFirePreview(PARCEL);
      expect(r.ok, `success: ${JSON.stringify(success)} was accepted`).toBe(false);
    }
  });

  it('a 200 with no success field at all is not a preview', async () => {
    answer({ status: 200, body: JSON.stringify({ error: 'Missing required property fields' }) });
    const r = await fetchFloodFirePreview(PARCEL);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.reason).toBe('api_error');
    // The vendor's message reaches the operator; absent `success` is recorded
    // as absent rather than as a `false` the vendor never sent.
    expect(r.message).toContain('Missing required property fields');
    expect(r.evidence!.success).toBeNull();
  });

  it('a 200 saying success:true with NO image is not a preview either', async () => {
    answer({ status: 200, body: JSON.stringify({ success: true, order_link: 'https://x/y' }) });
    const r = await fetchFloodFirePreview(PARCEL);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.reason).toBe('no_image');
  });

  it('a 200 whose image_data is not a PNG is not a preview', async () => {
    // Buffer.from(..., 'base64') drops invalid characters and returns whatever
    // it managed, so a decoded error string would otherwise become an "image".
    answer({ status: 200, body: JSON.stringify({ success: true, image_data: Buffer.from('not an image at all').toString('base64') }) });
    const r = await fetchFloodFirePreview(PARCEL);
    expect(r.ok ? '' : r.reason).toBe('no_image');
  });
});

describe('isPreview, on its own', () => {
  it('needs the status AND the flag', () => {
    expect(isPreview(200, { success: true })).toBe(true);
    expect(isPreview(200, { success: false })).toBe(false);
    expect(isPreview(200, {})).toBe(false);
    expect(isPreview(200, null)).toBe(false);
    // A 2xx that is not 200 still counts; a 3xx does not.
    expect(isPreview(204, { success: true })).toBe(true);
    expect(isPreview(300, { success: true })).toBe(false);
    expect(isPreview(401, { success: true })).toBe(false);
    expect(isPreview(500, { success: true })).toBe(false);
  });
});

describe('a real preview', () => {
  it('decodes the PNG and keeps the order link', async () => {
    answer({ status: 200, body: JSON.stringify({ success: true, image_data: PNG_B64, order_link: 'https://www.mynhd.com/ffprevorder/123/abc' }) });
    const r = await fetchFloodFirePreview(PARCEL);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.message);
    expect(isPng(r.png)).toBe(true);
    expect(r.orderLink).toBe('https://www.mynhd.com/ffprevorder/123/abc');
  });

  it('returns bytes, not base64 — the caller stores a file', async () => {
    answer({ status: 200, body: JSON.stringify({ success: true, image_data: PNG_B64 }) });
    const r = await fetchFloodFirePreview(PARCEL);
    expect(Buffer.isBuffer(r.ok ? r.png : null)).toBe(true);
    // And a missing order_link is null rather than ''.
    expect(r.ok ? r.orderLink : 'x').toBeNull();
  });

  it('tolerates a data: prefix the guide says will not be there', async () => {
    answer({ status: 200, body: JSON.stringify({ success: true, image_data: `data:image/png;base64,${PNG_B64}` }) });
    const r = await fetchFloodFirePreview(PARCEL);
    // Trusted it, and it decodes to leading garbage rather than failing — so it
    // is stripped. Being wrong about this silently produces a corrupt sheet.
    expect(r.ok).toBe(true);
  });
});

describe('searching by parcel', () => {
  it('sends search:apn with the FIPS in the vendor\'s `county` field', async () => {
    answer({ status: 200, body: JSON.stringify({ success: true, image_data: PNG_B64 }) });
    await fetchFloodFirePreview({ apn: ' 8381-021-001 ', fips: ' 06037 ', state: 'ca' });
    expect(calls[0]!.body).toEqual({
      search: 'apn', apn: '8381-021-001', county: '06037', state: 'CA',
    });
  });

  it('hits the /image endpoint, not the URL-based one', async () => {
    // POST /report/getMultiFloodFirePreview returns pdf_url/img_url and
    // ffprevorderlink, and not the bytes. The guide says not to use it.
    answer({ status: 200, body: JSON.stringify({ success: true, image_data: PNG_B64 }) });
    await fetchFloodFirePreview(PARCEL);
    expect(calls[0]!.url).toBe('https://api.mynhd.test/report/getMultiFloodFirePreview/image');
  });

  it('carries the bearer token', async () => {
    answer({ status: 200, body: JSON.stringify({ success: true, image_data: PNG_B64 }) });
    await fetchFloodFirePreview(PARCEL);
    expect(calls[0]!.auth).toMatch(/^Bearer tok-/);
  });
});

describe('401 + tryReAuth', () => {
  it('gets a new token and retries exactly once', async () => {
    answer(
      { status: 401, body: JSON.stringify({ error: 'JWT Token is wrong.', tryReAuth: true }) },
      { status: 200, body: JSON.stringify({ success: true, image_data: PNG_B64 }) },
    );
    const r = await fetchFloodFirePreview(PARCEL);
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(2);
    // A DIFFERENT token on the retry. Re-reading the cache would hand back the
    // same dead string forever, so the refresh has to bypass it.
    expect(calls[0]!.auth).not.toBe(calls[1]!.auth);
    expect(r.ok && r.evidence.reAuthed).toBe(true);
  });

  it('does not retry a 401 that does not ask for it', async () => {
    answer({ status: 401, body: JSON.stringify({ error: 'Nope' }) });
    const r = await fetchFloodFirePreview(PARCEL);
    expect(calls).toHaveLength(1);
    expect(r.ok ? '' : r.reason).toBe('auth_failed');
  });

  it('gives up after one retry rather than looping', async () => {
    // A retry loop against a vendor we do not pay per call is still a retry
    // loop against somebody else's rate limit.
    answer(
      { status: 401, body: JSON.stringify({ tryReAuth: true }) },
      { status: 401, body: JSON.stringify({ tryReAuth: true }) },
    );
    const r = await fetchFloodFirePreview(PARCEL);
    expect(calls).toHaveLength(2);
    expect(r.ok ? '' : r.reason).toBe('auth_failed');
  });

  it('saysReAuth needs the 401 and the flag', () => {
    expect(saysReAuth(401, { tryReAuth: true })).toBe(true);
    expect(saysReAuth(401, {})).toBe(false);
    expect(saysReAuth(500, { tryReAuth: true })).toBe(false);
  });
});

describe('the other documented statuses', () => {
  it('403 says the account needs preview access, not that something broke', async () => {
    answer({ status: 403, body: JSON.stringify({ error: 'Forbidden' }) });
    const r = await fetchFloodFirePreview(PARCEL);
    expect(r.ok ? '' : r.reason).toBe('no_permission');
    expect(r.ok ? '' : r.message).toContain('MyNHD has to enable it');
  });

  it('500 is an api_error carrying the vendor\'s words', async () => {
    answer({ status: 500, body: JSON.stringify({ error: 'Preview generation failed' }) });
    const r = await fetchFloodFirePreview(PARCEL);
    expect(r.ok ? '' : r.reason).toBe('api_error');
    expect(r.ok ? '' : r.message).toContain('Preview generation failed');
  });

  it('a non-JSON body does not throw', async () => {
    answer({ status: 502, body: '<html>Bad Gateway</html>' });
    const r = await fetchFloodFirePreview(PARCEL);
    expect(r.ok ? '' : r.reason).toBe('api_error');
  });
});

describe('unconfigured means no call at all', () => {
  it('refuses without reaching the vendor', async () => {
    delete process.env.MYNHD_SECRET_KEY;
    answer({ status: 200, body: JSON.stringify({ success: true, image_data: PNG_B64 }) });
    const r = await fetchFloodFirePreview(PARCEL);
    expect(r.ok ? '' : r.reason).toBe('not_configured');
    // No mock, no fallback, and nothing on the wire.
    expect(calls).toHaveLength(0);
  });
});

describe('the secret stays out of everything', () => {
  it('is read from the environment in auth.ts and nowhere else', () => {
    const client = readSource('src/lib/integrations/mynhd/client.ts', {
      mustContain: 'export async function fetchFloodFirePreview',
    });
    // NAMING the variable is fine and useful — "MYNHD_SECRET_KEY missing" is
    // what makes an unconfigured deploy diagnosable. READING it is what must
    // happen in one place, so there is one place to check.
    expect(client).not.toMatch(/process\.env\.MYNHD_SECRET_KEY/);
    expect(client).not.toContain('secretkey');

    const auth = readSource('src/lib/integrations/mynhd/auth.ts', {
      mustContain: 'export function getConfig',
    });
    expect((auth.match(/process\.env\.MYNHD_SECRET_KEY/g) ?? []).length).toBe(1);
  });

  it('is never put in a request log or a thrown message', () => {
    const auth = readSource('src/lib/integrations/mynhd/auth.ts', {
      mustContain: 'export async function getAccessToken',
    });
    // The secret is SENT as a form field. It must appear nowhere near a log
    // call or an Error — the value, not the variable's name.
    expect(auth).not.toMatch(/logRequest\([\s\S]*?secretKey/);
    expect(auth).not.toMatch(/new (MyNhdAuthError|Error)\([\s\S]{0,200}?config\.secretKey/);
    // And the body it goes into is the only use of it.
    expect((auth.match(/config\.secretKey|secretKey:/g) ?? []).length).toBeLessThanOrEqual(2);
  });

  it('is server-only — nothing under components imports this', () => {
    // MyNHD's CORS forbids browser calls, and a secret in a browser is a
    // published secret.
    const client = readSource('src/lib/integrations/mynhd/client.ts', {
      mustContain: 'export async function fetchFloodFirePreview',
    });
    expect(client).not.toContain("'use client'");
  });
});
