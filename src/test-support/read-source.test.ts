import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readSource, sliceFrom } from './read-source';

// The helper exists so a guard cannot pass while reading nothing. These are
// the two ways that happened in practice, reproduced.

const dir = mkdtempSync(join(tmpdir(), 'read-source-'));
const write = (name: string, body: string) => {
  const p = join(dir, name);
  writeFileSync(p, body);
  return p;
};

describe('the anchor is mandatory', () => {
  it('returns the source when the anchor is there', () => {
    const p = write('a.ts', 'export function keep() { return 1; }\n');
    expect(readSource(p, { mustContain: 'export function keep' })).toContain('return 1');
  });

  it('THROWS when the anchor is gone, rather than returning a file it no longer understands', () => {
    // The real case: a function is renamed, and every assertion about it
    // silently stops matching. Without this the guard goes green.
    const p = write('b.ts', 'export function renamed() { return 1; }\n');
    expect(() => readSource(p, { mustContain: 'export function keep' }))
      .toThrow(/no longer contains/);
  });

  it('names every missing anchor, not just the first', () => {
    const p = write('c.ts', 'nothing here\n');
    expect(() => readSource(p, { mustContain: ['alpha', 'beta'] })).toThrow(/"alpha", "beta"/);
  });

  it('says so when the file is missing entirely', () => {
    expect(() => readSource(join(dir, 'nope.ts'), { mustContain: 'x' })).toThrow(/could not be read/);
  });
});

describe('CRLF cannot change what a guard is about', () => {
  // git checks these files out as CRLF on Windows. A guard slicing on '\n  }\n'
  // found nothing, indexOf returned -1, and the slice ran to end-of-file —
  // swallowing the next function, which legitimately did the thing the guard
  // was asserting nobody did.
  const body = 'function a() {\r\n  return 1;\r\n}\r\nfunction b() {\r\n  forbidden();\r\n}\r\n';

  it('normalises line endings before anything looks at the text', () => {
    const p = write('crlf.ts', body);
    expect(readSource(p, { mustContain: 'function a' })).not.toContain('\r');
  });

  it('slices the same region whatever the file was checked out as', () => {
    const p = write('crlf2.ts', body);
    const src = readSource(p, { mustContain: 'function a' });
    const slice = sliceFrom(src, 'function a', '\n}\n');
    expect(slice).toContain('return 1');
    expect(slice, 'the slice ran past its function and swallowed the next one')
      .not.toContain('forbidden');
  });
});

describe('a slice that cannot find its end is an error', () => {
  it('refuses rather than returning the rest of the file', () => {
    // "Everything to the end" is how a guard about one function quietly
    // becomes a guard about the whole module.
    const p = write('open.ts', 'function a() {\n  return 1;\n');
    const src = readSource(p, { mustContain: 'function a' });
    expect(() => sliceFrom(src, 'function a', '\n}\n')).toThrow(/not its end/);
  });

  it('refuses a start it cannot find', () => {
    expect(() => sliceFrom('abc', 'zzz', 'x')).toThrow(/is not in this source/);
  });
});
