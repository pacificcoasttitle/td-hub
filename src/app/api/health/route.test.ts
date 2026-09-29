import { afterEach, describe, expect, it } from 'vitest';
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
    expect(Object.keys(body).sort()).toEqual(['app', 'commit', 'conciergeFonts', 'status', 'timestamp']);
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
