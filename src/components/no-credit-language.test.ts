import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// ─── Operators are not shown what things cost ───────────────────────────────
//
// Removed on 2026-09-23 (Gerard). The cost gate, the type card, the duplicate
// panel and the Reports list all quoted credits, and an operator holds no
// budget and cannot read a balance — the production /credits endpoint returns
// a sentinel. Asking them to weigh a number that was never theirs is a
// decision dressed up as information.
//
// THE SPEND ITSELF IS UNTOUCHED. Every generation still writes
// sitex_credits_charged, and /api/concierge/spend still serves the admin usage
// view for the people who do own the cost. Only the operator-facing words went.
//
// WHAT CARRIES THE DELIBERATENESS NOW, since the wording was part of it: the
// confirmation dialog (Cancel focused, Enter swallowed, an explicit tick,
// disabled in flight) and the duplicate guard keyed on the normalised property
// over all time. Those are enforcement; the words were only description.
//
// This test exists because the words are easy to reintroduce one label at a
// time, and each one reads as harmless on its own.

const COMPONENTS = join(process.cwd(), 'src', 'components');

/** Files whose STRINGS an operator can read. Comments are stripped first. */
function uiFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) uiFiles(full, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

/**
 * Comments are internal and may say whatever is true — including "credit",
 * which is what the database column is called. Only rendered text counts.
 */
const stripComments = (s: string) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

describe('nothing an operator reads mentions credits', () => {
  const offenders = uiFiles(COMPONENTS)
    .map((f) => ({ file: relative(process.cwd(), f).replace(/\\/g, '/'), src: stripComments(readFileSync(f, 'utf8')) }))
    .flatMap(({ file, src }) => {
      // The identifiers are fine — `creditsCharged` is a real field we read.
      // A bare word "credit" in prose is not.
      const hits = [...src.matchAll(/(?<![A-Za-z_])credits?(?![A-Za-z_])/gi)];
      return hits.map((m) => `${file}: …${src.slice(Math.max(0, m.index! - 45), m.index! + 25).replace(/\s+/g, ' ')}…`);
    });

  it('finds the components at all', () => {
    // A walk that silently found nothing would pass forever.
    expect(uiFiles(COMPONENTS).length).toBeGreaterThan(50);
  });

  it('has no credit wording in any component', () => {
    expect(offenders, 'operator-facing credit language. The spend is real and still '
      + 'metered, but it is not the operator\'s to weigh — see the header of this file.')
      .toEqual([]);
  });
});
