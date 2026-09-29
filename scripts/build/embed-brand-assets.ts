/**
 * Generates src/lib/domain/concierge/document/brand-assets.ts — the PCT mark
 * as a base64 data URI, inlined into source.
 *
 * WHY INLINE RATHER THAN READ AT RUNTIME. `public/` is served statically and
 * is not guaranteed to be inside a Vercel function's bundle, and react-pdf's
 * <Image> renders EMPTY for a src it cannot resolve rather than throwing. That
 * combination ships a blank band that looks fine in every local render and in
 * every test, and is wrong only in production — the exact shape of failure
 * AGENTS.md records for the sidebar clipping: correct source, invisible result.
 *
 * Inlining removes the question. There is no path to resolve, so there is
 * nothing to differ between `next dev`, a function and vitest.
 *
 * Re-run after changing the logo:
 *   npx tsx scripts/build/embed-brand-assets.ts
 *
 * brand-assets.test.ts checks the committed file matches the PNG on disk, so a
 * logo changed without re-running this fails rather than drifting.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

const ROOT = process.cwd();
const SOURCES = [
  { name: 'PCT_LOGO_WHITE', file: join(ROOT, 'public', 'logo2-light.png'), mime: 'image/png' },
] as const;

const OUT = join(ROOT, 'src', 'lib', 'domain', 'concierge', 'document', 'brand-assets.ts');

export function dataUriFor(file: string, mime: string): string {
  const bytes = readFileSync(file);
  if (bytes.length === 0) throw new Error(`${file} is empty`);
  // A PNG that is not a PNG would inline happily and render as nothing.
  if (mime === 'image/png' && bytes.subarray(0, 4).toString('hex') !== '89504e47') {
    throw new Error(`${file} is not a PNG (magic bytes ${bytes.subarray(0, 4).toString('hex')})`);
  }
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

function main() {
  const parts = SOURCES.map(({ name, file, mime }) => {
    const uri = dataUriFor(file, mime);
    const kb = (uri.length / 1024).toFixed(1);
    console.log(`  ${name}: ${file} -> ${kb} KB data URI`);
    return `/** From public/${file.split(/[\\/]/).pop()}. Regenerate with scripts/build/embed-brand-assets.ts. */\nexport const ${name} = '${uri}';`;
  });

  const body = `// GENERATED FILE — do not edit by hand.
//
// Produced by scripts/build/embed-brand-assets.ts from the PNGs in public/.
// Inlined rather than read at runtime because react-pdf renders an
// unresolvable <Image> src as empty rather than failing, which would ship a
// blank band that every local render and every test shows as fine.

${parts.join('\n\n')}
`;

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, body, 'utf8');
  console.log(`\nWrote ${OUT}`);
}

if (process.argv[1] && process.argv[1].includes('embed-brand-assets')) main();
