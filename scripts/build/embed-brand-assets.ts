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
 * brand-assets.test.ts checks each committed data URI against the file on
 * disk, so an asset changed without re-running this fails rather than drifting.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

const ROOT = process.cwd();
const SOURCES = [
  { name: 'PCT_LOGO_WHITE', file: join(ROOT, 'public', 'logo2-light.png'), mime: 'image/png' },
  /**
   * The Concierge cover photograph, the same on every profile.
   *
   * COMMITTED DOWNSCALED, 1836x1413 — three times the 612x471 it renders at,
   * which is ample for print. The original Gerard supplied was 10,625x8,175
   * and 14.3 MB; inlined as base64 that is roughly 20 MB of text in a .ts file
   * that every developer pulls forever and every build carries. The downscale
   * is visually identical on the page at 494 KB.
   *
   * Its aspect ratio (1.2997) already matches the slot (612/471 = 1.2994), so
   * the resize is a straight reduction and crops nothing.
   */
  { name: 'PCT_COVER_PHOTO', file: join(ROOT, 'public', 'concierge-cover.jpg'), mime: 'image/jpeg' },
  /**
   * The dark wordmark, for the cover.
   *
   * The white one is correct on the navy bands and INVISIBLE on the cover: the
   * photograph's top-right corner is bright sky, so only the coloured swoosh
   * survives and "PACIFIC COAST TITLE COMPANY" disappears entirely. The
   * photograph is the same on every profile, so this is deterministic rather
   * than a case that might not come up.
   */
  { name: 'PCT_LOGO_DARK', file: join(ROOT, 'public', 'logo2-dark.png'), mime: 'image/png' },
] as const;

/**
 * First bytes that prove a file is what its mime says.
 *
 * KEPT RATHER THAN RELAXED when JPEG was added. react-pdf renders an <Image>
 * it cannot decode as EMPTY rather than throwing, so a JPEG that is not a JPEG
 * inlines happily, passes every test, and produces a blank cover in
 * production — the same failure the logo inlining exists to prevent.
 */
const MAGIC: Record<string, { hex: string; label: string }> = {
  'image/png': { hex: '89504e47', label: 'PNG' },
  'image/jpeg': { hex: 'ffd8ff', label: 'JPEG' },
};

/** A guard on the size of what lands in source, not just on the file. */
const MAX_DATA_URI_KB = 800;

const OUT = join(ROOT, 'src', 'lib', 'domain', 'concierge', 'document', 'brand-assets.ts');

export function dataUriFor(file: string, mime: string): string {
  const bytes = readFileSync(file);
  if (bytes.length === 0) throw new Error(`${file} is empty`);

  const magic = MAGIC[mime];
  if (!magic) throw new Error(`no magic-byte check defined for ${mime} — add one rather than skipping it`);
  const head = bytes.subarray(0, magic.hex.length / 2).toString('hex');
  if (head !== magic.hex) {
    throw new Error(`${file} is not a ${magic.label} (magic bytes ${head}, expected ${magic.hex})`);
  }

  const uri = `data:${mime};base64,${bytes.toString('base64')}`;
  // Base64 is ~4/3 of the bytes, and this lands in SOURCE. A 14 MB original
  // becomes ~20 MB of text in a file nobody can read or diff.
  const kb = uri.length / 1024;
  if (kb > MAX_DATA_URI_KB) {
    throw new Error(
      `${file} would inline as ${kb.toFixed(0)} KB of base64, over the ${MAX_DATA_URI_KB} KB ceiling. `
      + 'Downscale the source rather than raising the ceiling.',
    );
  }
  return uri;
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
