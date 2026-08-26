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
