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
// The comp address is stored on every row of concierge_profile_comps, and the
// candidate mapping in this file silently left it out. The generate path
// builds its candidates from normalizeComps, which carries the address, so the
// first render of a profile showed "1481 BONITA AVE" and a re-render of the
// SAME profile showed "Comparable 1".
//
// It was invisible for as long as it existed, because the v1 document never
// printed comp addresses at all. The v2 layout puts them on pages 5, 6 and 7,
// which is what surfaced it — on a profile re-rendered in production.
describe('a re-render carries the fields the document prints', () => {
  const src = readFileSync(join(__dirname, 'render.ts'), 'utf8').replace(/\r\n/g, '\n');
  const mapping = (() => {
    const at = src.indexOf('storedComps.map(');
    expect(at, 'the candidate mapping moved — this test reads it by name').toBeGreaterThan(-1);
    return src.slice(at, src.indexOf('}));', at));
  })();

  it('maps the comp address through, so pages 5 to 7 are not "Comparable 1"', () => {
    expect(mapping).toMatch(/address:\s*c\.address/);
  });

  it('carries the rest of the locality with it', () => {
    // A bare street line with no city is worse than none on a report that
    // states the comparables are near the subject.
    for (const f of ['city', 'state', 'zip'] as const) {
      expect(mapping, `${f} is stored on the row and belongs on the candidate`)
        .toContain(`${f}: c.${f}`);
    }
  });
});
