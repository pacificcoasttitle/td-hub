import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const panel = readFileSync(join(__dirname, 'documents-panel.tsx'), 'utf8');

/**
 * Slice a named function's body out of the source.
 *
 * Searching the whole file is how the first version of this test broke: the
 * phrase "None on file" appears in the module comment ABOVE the code, so
 * indexOf found the comment, the slice ran backwards and produced an empty
 * string that trivially "contained" nothing. Anchoring inside the function is
 * the fix, and the emptiness guard below is so a bad anchor fails loudly
 * instead of passing vacuously.
 */
function body(src: string, fn: string): string {
  const start = src.indexOf(`function ${fn}(`);
  if (start === -1) throw new Error(`no function ${fn} in source`);
  const next = src.slice(start + 1).search(/\nfunction \w+\(/);
  const out = next === -1 ? src.slice(start) : src.slice(start, start + 1 + next);
  if (out.trim().length < 50) throw new Error(`slice for ${fn} came back empty`);
  return out;
}
const gate = readFileSync(join(__dirname, 'concierge-cost-gate.tsx'), 'utf8');
const criteria = readFileSync(join(__dirname, 'concierge-criteria-panel.tsx'), 'utf8');

// ─── Absence is not the same sentence for every document ───────────────────
describe('the tiles do not claim more than we know', () => {
  it('SoftPro documents read "None on file", never "Not generated"', () => {
    // SoftPro returns an empty list for prelims on 410 of 418 Title & Escrow
    // orders and we do not know whether those documents exist somewhere the
    // endpoint does not expose. "Not generated" would tell an operator to stop
    // looking for something that may be in a folder we cannot see.
    const softpro = body(panel, 'SoftProTile');
    expect(softpro).toContain('None on file');
    expect(softpro).not.toContain('Not generated');
  });

  it('the Property Profile DOES read "Not generated" — we are the only maker', () => {
    const profile = body(panel, 'ProfileTile');
    expect(profile).toContain('Not generated');
  });
});

describe('an issued tile never offers Generate', () => {
  it('the issued branches offer only View, Download and the free adjust', () => {
    const fn = body(panel, 'SoftProTile');
    const issuedSoftPro = fn.slice(fn.indexOf('{issued ? ('), fn.indexOf('None on file'));
    expect(issuedSoftPro.length).toBeGreaterThan(50);
    expect(issuedSoftPro).toContain('View');
    expect(issuedSoftPro).toContain('Download');
    expect(issuedSoftPro).not.toMatch(/>\s*Generate/);
  });

  it('a rendered profile offers adjust, not regenerate', () => {
    const fn = body(panel, 'ProfileTile');
    const has = fn.slice(fn.indexOf('profile.hasPdf'), fn.indexOf("profile.status === 'pending'"));
    expect(has.length).toBeGreaterThan(50);
    expect(has).toContain('Adjust comparables — free');
    expect(has).not.toContain('1 credit');
  });
});

describe('cost is stated wherever it exists, and only where it exists', () => {
  it('every spending control says the price', () => {
    for (const m of panel.matchAll(/onClick=\{onGenerateProfile\}[\s\S]{0,160}?<\/TileButton>/g)) {
      expect(m[0]).toContain('credit');
    }
  });

  it('nothing on the free paths mentions a credit as a cost', () => {
    expect(criteria).not.toMatch(/1 credit/);
    expect(criteria).toContain('Free —');
    expect(criteria).toContain('Re-render — free');
    // A failed RENDER is retried free; a failed CALL is not, and says so.
    expect(panel).toContain('Retry — free');
    expect(panel).toContain('Try again — 1 credit');
  });
});

// ─── The gate's safety properties, asserted rather than described ───────────
describe('the cost gate cannot fire on a mis-click', () => {
  it('focus lands on Cancel, not on the button that spends', () => {
    const cancelAt = gate.indexOf('autoFocus');
    const confirmAt = gate.indexOf('onClick={p.onConfirm}');
    expect(cancelAt).toBeGreaterThan(-1);
    expect(cancelAt).toBeLessThan(confirmAt);
  });

  it('Enter is swallowed and never confirms', () => {
    expect(gate).toContain("if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); }");
  });

  it('confirm is blocked in flight, so a double-click cannot double-spend', () => {
    expect(gate).toContain('p.submitting');
    expect(gate).toContain('disabled={blocked}');
  });

  it('requires an explicit acknowledgement of the charge', () => {
    expect(gate).toContain('!ack');
    expect(gate).toContain('I understand this charges one credit.');
  });

  it('shows OUR spend counts, and says why they are ours', () => {
    expect(gate).toContain('spend.thisMonth');
    expect(gate).toContain('spend.allTime');
    expect(gate).toContain('SiteX does not report a usable balance');
  });

  it('refuses to generate without a presenting rep', () => {
    expect(gate).toContain('missingRep');
  });
});
