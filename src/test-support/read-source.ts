import { readFileSync } from 'node:fs';

/**
 * ─── Reading a source file in a guard, without being able to read nothing ───
 *
 * A source-reading guard has two failure modes and they are not equal.
 *
 * BREAKING ON A REFACTOR is fine. The assertion fails, someone looks, and
 * either the guard or the code is wrong — loud, and dealt with.
 *
 * MATCHING NOTHING AND PASSING is the one that costs. A regex that cannot
 * match finds no violation, so the guard reports green while checking nothing.
 * It happened here twice in a day:
 *
 *   - `new RegExp(`${f}:\\s*c\\.${f}`)` written through a bash heredoc, which
 *     ate a backslash. Inside a template literal `\s` resolves to a plain `s`,
 *     so the pattern became `city:s*c.city` and matched nothing.
 *   - `s.indexOf('\n  }\n')` against a file git had checked out as CRLF.
 *     indexOf returned -1, the slice ran to end-of-file, and the assertion
 *     silently changed what it was about.
 *
 * Both are the vacuous-fixture disease in a different coat (EVIDENCE_RULES.md
 * rule 4): green, and measuring nothing.
 *
 * So this helper makes the anchor mandatory. You cannot read a source file for
 * a guard without naming something that must be in it — and if that thing is
 * absent, the guard fails HERE, saying the file moved, rather than passing an
 * assertion about text it never found.
 *
 * Line endings are normalised for the same reason: a guard's subject is the
 * code, not whether the machine that checked it out uses CRLF.
 */
export function readSource(path: string, opts: {
  /**
   * Text that must appear in the file for this guard to mean anything —
   * usually the declaration it is about. If it is gone, the guard is stale and
   * says so instead of quietly checking a file it no longer understands.
   */
  mustContain: string | readonly string[];
}): string {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new Error(`readSource: ${path} could not be read. A guard cannot assert anything about a file that is not there.`);
  }
  const src = raw.replace(/\r\n/g, '\n');

  const anchors = typeof opts.mustContain === 'string' ? [opts.mustContain] : opts.mustContain;
  const missing = anchors.filter((a) => !src.includes(a));
  if (missing.length > 0) {
    throw new Error(
      `readSource: ${path} no longer contains ${missing.map((m) => JSON.stringify(m)).join(', ')}.\n`
      + 'The guard reading this file is now asserting things about code that has moved or been renamed. '
      + 'Update the anchor and the assertions together — do not delete the anchor to make this pass.',
    );
  }
  return src;
}

/**
 * The text between an anchor and the first line matching `until`, with the
 * same mandatory-anchor rule.
 *
 * This is the slice that broke on CRLF. `until` is matched against a
 * NORMALISED string, and a slice that finds no end is an error rather than
 * "everything to the end of the file" — which is how a guard about one
 * function silently became a guard about the rest of the module.
 */
export function sliceFrom(src: string, from: string, until: string): string {
  const start = src.indexOf(from);
  if (start === -1) throw new Error(`sliceFrom: ${JSON.stringify(from)} is not in this source.`);
  const end = src.indexOf(until, start + from.length);
  if (end === -1) {
    throw new Error(
      `sliceFrom: found ${JSON.stringify(from)} but not its end ${JSON.stringify(until)}.\n`
      + 'Returning the rest of the file would make this guard assert things about whatever follows.',
    );
  }
  return src.slice(start, end);
}
