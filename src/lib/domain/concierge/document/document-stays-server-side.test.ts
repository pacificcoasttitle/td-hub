import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readSource, stripComments } from '@/test-support/read-source';

// ─── The PDF document must not reach the browser ────────────────────────────
//
// reports-list-page.tsx is a client component. It imported TEMPLATE_VERSION
// from profile-document.tsx — one string — and that pulled the whole document
// into the CLIENT bundle: @react-pdf/renderer, `node:fs` through fonts.ts, and
// ~670 KB of base64 in brand-assets.ts.
//
// The Turbopack build failed on it, which was the lucky outcome:
//
//   Code generation for chunk item errored
//   [project]/src/components/admin/reports/reports-list-page.tsx [app-client]
//
// Had it merely succeeded, every operator opening /reports would have
// downloaded a PDF renderer and two inlined images in order to render one
// version string. `npm run verify` does not build, so nothing local caught it —
// CI did.
//
// The fix is template-version.ts, a leaf module importing nothing. This keeps
// it that way.

const SRC = join(process.cwd(), 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const rel = (f: string) => relative(SRC, f).split('\\').join('/');

/** Source with comments removed, so an assertion cannot read prose as code. */
// ONE implementation, in read-source.ts. This file had its own copy, which is
// how two subtly different comment strippers end up in a codebase that has
// been bitten by comments twice.
const code = stripComments;

/** Modules too heavy for a browser bundle, by the path a client would import. */
const SERVER_ONLY = [
  'concierge/document/profile-document',
  'concierge/document/brand-assets',
  'concierge/document/fonts',
  'concierge/document/parts',
];

const files = walk(SRC).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));

/** Files carrying the 'use client' directive. */
const clientFiles = files.filter((f) => {
  const head = readFileSync(f, 'utf8').slice(0, 200);
  return /^\s*(['"])use client\1/m.test(head);
});

describe('the concierge document never enters a client bundle', () => {
  it('finds client components at all', () => {
    // A detector matching nothing would pass forever.
    expect(clientFiles.length).toBeGreaterThan(20);
  });

  it('no client component imports the document, its fonts or its assets', () => {
    const offenders: string[] = [];
    for (const f of clientFiles) {
      const src = readFileSync(f, 'utf8');
      const body = code(src);
      for (const mod of SERVER_ONLY) {
        // Matches '@/lib/domain/concierge/document/x' and relative forms.
        if (new RegExp(`from\\s+['"][^'"]*${mod.replace(/\//g, '\\/')}['"]`).test(src)) {
          offenders.push(`${rel(f)} imports ${mod}`);
        }
      }
    }
    expect(offenders, 'a client component pulling the PDF document into the browser bundle — '
      + 'import TEMPLATE_VERSION from document/template-version, which imports nothing')
      .toEqual([]);
  });

  it('template-version.ts imports nothing, which is the whole point', () => {
    // readSource, not readFileSync: it fails loudly if the anchor is gone
    // rather than asserting about a file it no longer understands, and it
    // strips comments so the prose explaining the rule is not read as code.
    const src = readSource(join(SRC, 'lib/domain/concierge/document/template-version.ts'), {
      mustContain: 'export const TEMPLATE_VERSION',
    });
    expect(src).not.toMatch(/^\s*import\s/m);
  });

  it('font-files.ts stays free of the renderer, for the same reason', () => {
    // /api/health reads it to report font presence and has no business
    // carrying a PDF renderer to answer "is this file here?".
    //
    // COMMENTS STRIPPED FIRST. font-files.ts explains in prose why it does not
    // import the renderer, and the first version of this assertion read that
    // explanation as the thing it forbade and failed. AGENTS.md records the
    // mirror image — an assertion passing because the comment above it
    // contained the string it was hunting. Either way the subject is the code.
    const src = readSource(join(SRC, 'lib/domain/concierge/document/font-files.ts'), {
      mustContain: 'export const FONT_FILES',
    });
    expect(src).not.toContain('@react-pdf/renderer');
  });
});
