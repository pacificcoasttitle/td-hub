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
  // The dark wordmark was here for one day. It solved the white mark vanishing
  // against bright sky by swapping the logo; v6 solves it by fading the top of
  // the photograph instead, which keeps one logo on every surface. Removed
  // rather than left unused — an inlined asset nothing references is ~11 KB of
  // base64 that the next reader has to work out is dead.
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

/**
 * Navy → transparent down the top `fadePt` of the cover, baked in.
 *
 * NOT DRAWN AT RENDER TIME, and not for want of trying. v6 asks for
 * rgba(27,42,74,.7) fading to transparent by 90 pt. react-pdf's
 * <LinearGradient> carries no alpha on its stops — measured down the rendered
 * page, `stopOpacity` produced a solid 90 pt slab with a hard edge, and
 * `stopColor="rgba(...)"` interpolated but came out magenta with the alpha in
 * the blue channel. A stack of 60 opacity Views does fade, but each seam
 * anti-aliases into a hairline and the result is visibly striped.
 *
 * The same round-one spec says to bake the page-2–8 band's greyscale into a
 * PNG "because react-pdf has no CSS filter". This is that, for the fade.
 *
 * The clean photograph stays the committed source; the fade is applied here,
 * so the parameters live in code and regenerating reproduces it exactly.
 */
const FADE_PT = 90;
const COVER_RENDER_PT = 471;
const FADE_FROM = 0.7;

/**
 * Hold the full opacity until the logo has cleared, THEN fade.
 *
 * A straight linear ramp from 0.7 at the top edge to 0 at 90 pt spends half
 * its darkness on empty sky above the mark: by 45.5 pt — the bottom of the
 * logo — it is down to ~0.35, and over a bright cloud that left "TITLE
 * COMPANY" legible but pale.
 *
 * The band is still 90 pt, still starts at 0.7, still reaches nothing at 90.
 * Only the curve changes, so the fade does its work where the logo actually
 * is. The logo sits at top 22.5 with height 23, hence 45.5.
 */
const LOGO_BOTTOM_PT = 45.5;

async function withCoverFade(jpeg: Buffer): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  const meta = await sharp(jpeg).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (!w || !h) throw new Error('cover has no dimensions');

  // 90 pt of the 471 pt the cover renders at, scaled to the asset's pixels.
  const ptToPx = h / COVER_RENDER_PT;
  const fadePx = Math.round(FADE_PT * ptToPx);
  const holdPx = Math.round(LOGO_BOTTOM_PT * ptToPx);
  const overlay = Buffer.alloc(w * fadePx * 4);
  for (let y = 0; y < fadePx; y++) {
    // Flat at FADE_FROM through the logo's depth, then linear to nothing.
    const t = y <= holdPx ? 1 : 1 - (y - holdPx) / (fadePx - 1 - holdPx);
    const alpha = Math.round(255 * FADE_FROM * Math.max(0, t));
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      overlay[i] = 27; overlay[i + 1] = 42; overlay[i + 2] = 74; overlay[i + 3] = alpha;
    }
  }
  return sharp(jpeg)
    .composite([{ input: overlay, raw: { width: w, height: fadePx, channels: 4 }, top: 0, left: 0 }])
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();
}

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

async function main() {
  const parts: string[] = [];
  for (const { name, file, mime } of SOURCES) {
    // The cover carries its fade baked in; everything else inlines as-is.
    const faded = name === 'PCT_COVER_PHOTO';
    let uri: string;
    if (faded) {
      const out = await withCoverFade(readFileSync(file));
      uri = `data:${mime};base64,${out.toString('base64')}`;
      const kb = uri.length / 1024;
      if (kb > MAX_DATA_URI_KB) {
        throw new Error(`${file} would inline as ${kb.toFixed(0)} KB after the fade, over the ${MAX_DATA_URI_KB} KB ceiling.`);
      }
    } else {
      uri = dataUriFor(file, mime);
    }
    console.log(`  ${name}: ${file} -> ${(uri.length / 1024).toFixed(1)} KB data URI${faded ? ' (fade baked in)' : ''}`);
    parts.push(
      `/** From public/${file.split(/[\\/]/).pop()}${faded ? ', with the v6 cover fade composited in' : ''}. Regenerate with scripts/build/embed-brand-assets.ts. */\n`
      + `export const ${name} = '${uri}';`,
    );
  }

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

if (process.argv[1] && process.argv[1].includes('embed-brand-assets')) {
  main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
}
