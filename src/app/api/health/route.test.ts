import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET, buildSha } from './route';

const ORIGINAL = process.env.VERCEL_GIT_COMMIT_SHA;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
  else process.env.VERCEL_GIT_COMMIT_SHA = ORIGINAL;
});

describe('buildSha', () => {
  it('returns the Vercel-injected commit SHA when present', () => {
    process.env.VERCEL_GIT_COMMIT_SHA = '07d1db0248fa0c9e1b3d4a5f6e7c8b9a0d1e2f34';
    expect(buildSha()).toBe('07d1db0248fa0c9e1b3d4a5f6e7c8b9a0d1e2f34');
  });

  it("falls back to 'unknown' when the variable is absent (local dev)", () => {
    delete process.env.VERCEL_GIT_COMMIT_SHA;
    expect(buildSha()).toBe('unknown');
  });
});

describe('GET /api/health', () => {
  it('always includes a commit field — this is the point of the endpoint', async () => {
    process.env.VERCEL_GIT_COMMIT_SHA = 'abc123';
    const body = await (await GET()).json();
    expect(body).toHaveProperty('commit');
    expect(body.commit).toBe('abc123');
  });

  it('includes commit even with no SHA set, so the field is never missing', async () => {
    delete process.env.VERCEL_GIT_COMMIT_SHA;
    const body = await (await GET()).json();
    expect(body.commit).toBe('unknown');
  });

  it('leaves the existing response otherwise unchanged', async () => {
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.app).toBe('td-hub');
    expect(typeof body.timestamp).toBe('string');
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
    // Exactly the known keys — nothing else leaked into an unauthenticated
    // endpoint. `conciergeFonts` was added deliberately; see below.
    expect(Object.keys(body).sort()).toEqual(['app', 'commit', 'conciergeFonts', 'mynhd', 'status', 'timestamp']);
  });
});

describe('conciergeFonts — is the deployed bundle carrying the TTFs', () => {
  // Rule 3: a local render says nothing about the deployed function's
  // filesystem. Re-rendering a profile there needs a session, and this
  // endpoint has none — so it reports file presence instead, which one
  // unauthenticated curl can read after a deploy.

  it('reports every font the document registers', async () => {
    const body = await (await GET()).json();
    expect(body.conciergeFonts.expected).toBeGreaterThanOrEqual(7);
    expect(body.conciergeFonts).toHaveProperty('ok');
    expect(Array.isArray(body.conciergeFonts.missing)).toBe(true);
  });

  it('is ok in this checkout, where the files are committed', async () => {
    const body = await (await GET()).json();
    expect(body.conciergeFonts.missing).toEqual([]);
    expect(body.conciergeFonts.ok).toBe(true);
  });

  it('publishes filenames only — no paths off the server', async () => {
    const body = await (await GET()).json();
    const blob = JSON.stringify(body.conciergeFonts);
    expect(blob).not.toContain('/');
    expect(blob).not.toContain('\\');
  });
});

// ─── mynhd — which MyNHD would this deploy call ──────────────────────────────
//
// MyNHD issued a DEV-ENVIRONMENT key (13 Oct 2026). readConfig() refuses the
// production target against any host but MyNHD's production one, so the
// crossing cannot happen in code — but "cannot" is a claim about code, and
// where the key and the URL actually are is the thing worth checking. On the
// day the key was issued it went onto the production target instead of
// preview, which is the arrangement this makes visible with one curl.

describe('mynhd — the crossing is auditable, not just enforced', () => {
  const KEYS = ['MYNHD_SECRET_KEY', 'MYNHD_BASE_URL', 'VERCEL_ENV'] as const;
  let saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    for (const k of KEYS) delete process.env[k];
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('is ok and unconfigured when no key is set — that is a valid state', async () => {
    // On a target MyNHD is deliberately not enabled for, no key is correct and
    // must not show as a fault. The URL still resolves to the production
    // fallback; productionHost must not change meaning when a key arrives.
    const body = await (await GET()).json();
    expect(body.mynhd).toMatchObject({ configured: false, productionHost: true, ok: true });
  });

  it('classifies a configured dev URL without requiring a key', async () => {
    process.env.MYNHD_BASE_URL = 'https://dev-api.mynhd.test';
    process.env.VERCEL_ENV = 'preview';
    const body = await (await GET()).json();
    expect(body.mynhd).toMatchObject({
      configured: false,
      productionHost: false,
      ok: true,
      target: 'preview',
    });
  });

  it('reports the production host when a key is set and no URL overrides it', async () => {
    process.env.MYNHD_SECRET_KEY = 'k';
    const body = await (await GET()).json();
    expect(body.mynhd).toMatchObject({ configured: true, productionHost: true, ok: true });
  });

  it('reports a dev host on preview as configured, not production, and still ok', async () => {
    // The intended arrangement for the dev key.
    process.env.MYNHD_SECRET_KEY = 'k';
    process.env.MYNHD_BASE_URL = 'https://dev-api.mynhd.test';
    process.env.VERCEL_ENV = 'preview';
    const body = await (await GET()).json();
    expect(body.mynhd).toMatchObject({ configured: true, productionHost: false, ok: true, target: 'preview' });
  });

  it('goes NOT ok when the production target is pointed at a dev host', async () => {
    // The one state worth a red light: configured, and refused.
    process.env.MYNHD_SECRET_KEY = 'k';
    process.env.MYNHD_BASE_URL = 'https://dev-api.mynhd.test';
    process.env.VERCEL_ENV = 'production';
    const body = await (await GET()).json();
    expect(body.mynhd).toMatchObject({ configured: true, productionHost: false, ok: false });
  });

  it('publishes no hostname and no key — booleans and the target only', async () => {
    // This endpoint is unauthenticated. The dev server's hostname is in
    // vendor_api_logs for anyone with a session, which is where it belongs.
    process.env.MYNHD_SECRET_KEY = 'super-secret-value';
    process.env.MYNHD_BASE_URL = 'https://dev-api.mynhd.test';
    const blob = JSON.stringify((await (await GET()).json()).mynhd);
    expect(blob).not.toContain('super-secret-value');
    expect(blob).not.toContain('mynhd.test');
    expect(blob).not.toContain('api.mynhd.com');
    expect(blob).not.toContain('://');
  });
});
