import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The constraint is that re-filtering and re-rendering can NEVER spend a credit.
// A comment saying so is not a guarantee; an import that cannot exist is.
describe('rendering cannot reach the vendor', () => {
  const src = readFileSync(join(__dirname, 'render.ts'), 'utf8');

  it('imports nothing from the SiteX integration', () => {
    expect(src).not.toMatch(/from\s+['"].*integrations\/sitex/);
    expect(src).not.toContain('fetchConciergeProfile');
    expect(src).not.toContain('getConciergeFeedId');
  });

  it('makes no outbound fetch of its own', () => {
    // S3 reads go through the client helper; there is no raw fetch here.
    expect(src).not.toMatch(/\bfetch\s*\(/);
  });

  it('never writes a credit charge', () => {
    // Only the generate path may touch this column.
    expect(src).not.toContain('sitexCreditsCharged');
  });

  it('refuses to render a profile whose retrieval failed', () => {
    // Otherwise "retry render" becomes a way to retry the CALL.
    expect(src).toContain("profile.status === 'failed' && !profile.rawStorageKey");
  });

  it('reads images from our storage, not from the vendor map URL', () => {
    expect(src).toContain('platmapStorageKey');
    expect(src).toContain('compMapStorageKey');
    expect(src).not.toContain('compMapUrl');
  });
});

// ─── A re-render must print what the first render printed ───────────────────
//
// The candidate mapping that used to live in render.ts is now comp-row.ts,
// shared with the generate path and held to a round-trip test
// (comp-row.test.ts). That test is strictly stronger than what stood here: it
// asserts EVERY field survives a write and a read back, rather than naming the
// one field that had gone missing.
//
// What remains worth asserting here is that this file still delegates. An
// inline mapping reintroduced in render.ts would pass comp-row's round trip —
// which tests the shared functions, not their callers — while quietly dropping
// fields again, which is exactly how the address was lost.
describe('the re-render path uses the shared comp mapping', () => {
  const src = readFileSync(join(__dirname, 'render.ts'), 'utf8').replace(/\r\n/g, '\n');

  it('builds candidates through compFromRow, not by hand', () => {
    expect(src).toContain('storedComps.map(compFromRow)');
  });

  it('has no hand-rolled candidate mapping left in it', () => {
    // The shape that went wrong: an object literal assembling a candidate
    // field by field from a stored row.
    expect(src).not.toMatch(/sourcePosition:\s*c\.sourcePosition/);
  });
});
