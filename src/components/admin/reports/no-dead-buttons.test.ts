import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// ─── No button without something to do ──────────────────────────────────────
//
// "Try again" and "Comparables" shipped on the Reports list as <button>s with
// no handler. They rendered, they looked clickable, and they did nothing — a
// control that does nothing is worse than one that is not there.
//
// Rendering cannot catch this: server-rendered markup drops onClick, so a dead
// button and a live one look identical. So this reads the source: every
// <button> in these components must have an onClick, or be a form's submit.

const HERE = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(HERE).filter((n) => n.endsWith('.tsx') && !n.includes('.test.'));

/** Each `<button ...>` opening tag, with its file and line. */
function buttons(file: string): Array<{ tag: string; line: number }> {
  const src = readFileSync(join(HERE, file), 'utf8');
  const out: Array<{ tag: string; line: number }> = [];
  const re = /<button\b([\s\S]*?)>/g;
  for (const m of src.matchAll(re)) {
    // An arrow inside an attribute ends the regex early — `onClick={() => …}`.
    // Extend to the real end of the tag by balancing braces.
    let tag = m[0];
    let depth = (tag.match(/\{/g) ?? []).length - (tag.match(/\}/g) ?? []).length;
    let i = m.index! + tag.length;
    while (depth > 0 && i < src.length) {
      const next = src.indexOf('>', i);
      if (next < 0) break;
      tag += src.slice(i, next + 1);
      i = next + 1;
      depth = (tag.match(/\{/g) ?? []).length - (tag.match(/\}/g) ?? []).length;
    }
    out.push({ tag, line: src.slice(0, m.index).split('\n').length });
  }
  return out;
}

describe('every button on the Reports page does something', () => {
  it('finds the buttons at all', () => {
    // A pattern that matched nothing would pass forever.
    expect(files.flatMap(buttons).length).toBeGreaterThan(10);
  });

  it.each(files)('%s', (file) => {
    const dead = buttons(file)
      .filter(({ tag }) => !/\bonClick=/.test(tag) && !/type="submit"/.test(tag))
      .map(({ line }) => `${file}:${line}`);
    expect(dead, 'a <button> with no onClick and not a submit — it will render and do nothing').toEqual([]);
  });
});
