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
    // Exactly the original three keys plus `commit` — nothing else leaked in.
    expect(Object.keys(body).sort()).toEqual(['app', 'commit', 'status', 'timestamp']);
  });
});
