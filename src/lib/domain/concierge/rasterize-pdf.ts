// ─── Rasterising a vendor PDF page at print resolution ──────────────────────
//
// MyNHD's hazard preview is a COMPLETE ONE-PAGE DOCUMENT — letterhead, two
// aerial photographs, and four tables of determinations in small print. They
// serve it two ways:
//
//   /image  a 1024px-wide PNG. Placed across the document's 528pt content
//           width that is 140 dpi, and the disclaimer type lands at about 5pt
//           and blurred. Measured, not guessed: see
//           src/lib/integrations/mynhd/fixtures/first-real-preview.json.
//   /pdf    the same page with VECTOR text.
//
// So we take the PDF and rasterise it ourselves at 300 dpi. The page comes out
// sharp at full width because the type is redrawn at the target size rather
// than scaled up from 1024px.
//
// ─── WHY NOT sharp, WHICH IS WHAT THE PLAT MAP USES ─────────────────────────
//
// sharp cannot read PDF in this install — `sharp.format.pdf.input.buffer` is
// false on 0.34.5 / libvips 8.17.3, because the prebuilt libvips excludes the
// PDF loader. The plat map's TIFF -> PNG path does not generalise to this, and
// assuming it did would have been a day lost to a wrong premise.
//
// ─── WHY pdfjs-dist + @napi-rs/canvas ───────────────────────────────────────
//
// Both are already in the tree: pdfjs-dist is a declared dependency (the PDF
// guards read text out of rendered documents with it), and @napi-rs/canvas
// arrives as pdfjs-dist's own optional dependency.
//
// THAT SECOND ONE IS DECLARED EXPLICITLY IN package.json, for the reason the
// plat map states about sharp: a transitive dependency that a future upgrade
// drops would break this silently, and silent is the failure mode this feature
// exists to avoid. It is also a NATIVE module, so the platform build has to
// resolve on Vercel's Linux runtime and not only on a Windows laptop — which
// is checked by rendering on the deployed function, not here.
//
// Rasterising happens ONCE, when the preview is fetched, and the PNG is
// stored — the same shape as the plat map. Re-rendering a profile never
// re-rasterises and never calls the vendor.

export type RasterOutcome =
  | { ok: true; png: Buffer; width: number; height: number; dpi: number }
  | { ok: false; reason: 'not_a_pdf' | 'no_pages' | 'render_failed'; detail: string };

/** A PDF starts with %PDF-. Cheap, and it keeps a decoded error page out. */
export function looksLikePdf(buf: Buffer): boolean {
  return buf.length > 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-';
}

/**
 * The first page of `pdf`, drawn at `dpi`.
 *
 * 300 is the usual print floor. A PDF page is measured in points at 72 per
 * inch, so the scale is simply dpi/72 — at 300 that is 4.167, and a letter
 * page becomes 2550 x 3300.
 */
export async function rasterizeFirstPage(
  pdf: Buffer,
  opts: { dpi?: number } = {},
): Promise<RasterOutcome> {
  const dpi = opts.dpi ?? 300;

  if (!looksLikePdf(pdf)) {
    return { ok: false, reason: 'not_a_pdf', detail: `Expected %PDF-, got ${JSON.stringify(pdf.subarray(0, 8).toString('latin1'))}.` };
  }

  try {
    // Imported lazily, both of them, so that a script or a test that never
    // rasterises does not pay for pdfjs or load a native binary — and so a
    // missing platform build surfaces here as a reason rather than as an
    // import-time crash somewhere unrelated.
    const [{ getDocument }, canvasMod] = await Promise.all([
      import('pdfjs-dist/legacy/build/pdf.mjs'),
      import('@napi-rs/canvas'),
    ]);

    const doc = await getDocument({
      data: new Uint8Array(pdf),
      // Quiet: this runs server-side in a request, and pdfjs is chatty about
      // fonts it has substituted.
      verbosity: 0,
    }).promise;

    if (doc.numPages < 1) {
      return { ok: false, reason: 'no_pages', detail: 'The PDF has no pages.' };
    }

    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: dpi / 72 });
    const width = Math.round(viewport.width);
    const height = Math.round(viewport.height);

    const canvas = canvasMod.createCanvas(width, height);
    const context = canvas.getContext('2d');

    // ─── THE PAGE MUST COME OUT OPAQUE WHITE ────────────────────────────
    //
    // A PDF page has no background of its own, and an unpainted @napi-rs
    // canvas is transparent black — checked, getImageData gives 0,0,0,0 —
    // which @react-pdf would place on the sheet as a BLACK rectangle.
    //
    // pdfjs already handles it: render() does `background || "#ffffff"`, so
    // the default is an opaque white fill before anything is drawn. An
    // explicit fillRect here was written first and then removed, because it
    // was unfalsifiable — the guard for it passed with the line deleted, since
    // pdfjs was doing the work either way. `background` is passed explicitly
    // instead, so the dependence is visible rather than inherited from a
    // default, and rasterize-pdf.test.ts asserts the OUTPUT is opaque white
    // on a page that paints nothing.
    await page.render({
      background: '#FFFFFF',
      // The types come from pdfjs's browser canvas; the napi canvas is
      // compatible at the 2D context level, which is all render() touches.
      canvasContext: context as unknown as CanvasRenderingContext2D,
      viewport,
      canvas: canvas as unknown as HTMLCanvasElement,
    }).promise;

    const png = canvas.toBuffer('image/png');
    if (!png || png.length === 0) {
      return { ok: false, reason: 'render_failed', detail: 'The canvas produced no PNG bytes.' };
    }

    return { ok: true, png: Buffer.from(png), width, height, dpi };
  } catch (err) {
    return {
      ok: false,
      reason: 'render_failed',
      detail: err instanceof Error ? err.message : 'Unknown rasterisation failure',
    };
  }
}

/**
 * Can this deploy rasterise at all?
 *
 * ─── THE ONE THING ONLY THE DEPLOY CAN ANSWER ───────────────────────────────
 *
 * @napi-rs/canvas is a NATIVE module. npm resolves a different binary per
 * platform — a Windows laptop installs `canvas-win32-x64-msvc`, Vercel's build
 * needs `canvas-linux-x64-gnu` — so "it works here" says nothing about there.
 * Without this, the first anyone would know is a 500 from a row action after
 * an operator clicked, which is the worst place to learn it.
 *
 * It checks the NATIVE part only, deliberately. pdfjs's legacy build is plain
 * JavaScript and will always resolve; loading it here would add several
 * hundred milliseconds to every health poll to prove something that cannot
 * fail. Creating a canvas and encoding one pixel exercises the binary, the
 * 2D context and the PNG encoder, which is the whole of the risk.
 */
export async function rasterizerHealth(): Promise<{ ok: boolean; detail?: string }> {
  try {
    const canvasMod = await import('@napi-rs/canvas');
    const canvas = canvasMod.createCanvas(2, 2);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, 2, 2);
    const out = canvas.toBuffer('image/png');
    if (!out || out.length === 0) return { ok: false, detail: 'the canvas encoded no bytes' };
    return { ok: true };
  } catch (err) {
    // The message names the missing platform package when that is the cause,
    // which is the thing somebody needs in order to fix it.
    return { ok: false, detail: err instanceof Error ? err.message.slice(0, 200) : 'unknown' };
  }
}

// ─── Encoding for the sheet: JPEG, under a budget ───────────────────────────
//
// THESE PROFILES GET EMAILED, so the document has a size the feature has to
// live inside. Gerard, 15 Oct 2026: the whole profile under 3 MB. A courtesy
// report that bounces is not a courtesy.
//
// The 300dpi PNG took profile 42 from 1.26 MB to 6.43 MB. PNG is lossless and
// is the wrong compression for this page: MyNHD's preview is half aerial
// photography, and photography is what JPEG is for. 4:4:4 chroma, not the
// default 4:2:0 — the colour resolution 4:2:0 throws away is exactly where the
// thin coloured rules and the green parcel outline live, and that outline is
// the one mark that says which parcel this is.
//
// QUALITY IS CHOSEN BY MEASURING, NOT BY PICKING. The ladder is tried highest
// first and the first result inside the budget wins, so a simple page keeps a
// high quality and a dense one steps down only as far as it must. If none fit,
// the smallest is returned WITH that stated — a sheet slightly over budget is
// better than no sheet, but the caller should know.
export const SHEET_JPEG_LADDER = [92, 85, 78, 70] as const;

/**
 * The image's share of the 3 MB document.
 *
 * The rest of a profile is about 1.26 MB measured on profile 42 — eight sheets
 * with a cover photograph, a comp map and a plat map. 1.5 MB for the hazard
 * sheet leaves roughly a quarter of a megabyte of headroom, and a profile with
 * twelve comparables is bigger than one with five.
 */
export const SHEET_MAX_BYTES = 1_500_000;

export interface EncodedSheet {
  buffer: Buffer;
  contentType: 'image/png' | 'image/jpeg';
  /** Null for PNG, which has no quality setting — it is lossless. */
  quality: number | null;
  bytes: number;
  /** False when nothing on offer fitted. */
  withinBudget: boolean;
}

/**
 * The smallest encoding that fits, preferring lossless when it is no larger.
 *
 * ─── "ALWAYS JPEG" WAS A GUESS, AND IT WAS WRONG HALF THE TIME ──────────────
 *
 * MyNHD's page is half aerial photography, so JPEG is obviously right for it —
 * and that reasoning was about to be applied to every page. The test caught
 * it: on a flat-colour document (navy bands, white, type) the 300dpi PNG is
 * 632 KB and JPEG q92 is 706 KB. JPEG is LARGER, and lossy, for that input.
 *
 * So nothing is assumed about the content. PNG is measured alongside the JPEG
 * ladder and wins ties, because at equal size lossless is strictly better. For
 * a photographic page JPEG will win on its own merits, which is the only
 * reason it should.
 */
export async function encodeForSheet(
  png: Buffer,
  opts: { maxBytes?: number } = {},
): Promise<EncodedSheet> {
  const maxBytes = opts.maxBytes ?? SHEET_MAX_BYTES;
  const sharp = (await import('sharp')).default;

  const candidates: EncodedSheet[] = [{
    buffer: png,
    contentType: 'image/png',
    quality: null,
    bytes: png.length,
    withinBudget: png.length <= maxBytes,
  }];

  for (const quality of SHEET_JPEG_LADDER) {
    // 4:4:4, not the default 4:2:0 — the colour resolution 4:2:0 discards is
    // where the thin coloured rules and the green parcel outline live, and
    // that outline is the one mark saying which parcel this is.
    const buf = await sharp(png).jpeg({ quality, chromaSubsampling: '4:4:4' }).toBuffer();
    candidates.push({
      buffer: buf,
      contentType: 'image/jpeg',
      quality,
      bytes: buf.length,
      withinBudget: buf.length <= maxBytes,
    });
  }

  const fitting = candidates.filter((c) => c.withinBudget);
  if (fitting.length > 0) {
    // Among those that fit, the best QUALITY, not the smallest file: the
    // budget is the constraint and fidelity is the goal. PNG is lossless so it
    // ranks top, then the ladder in descending quality — which is the order
    // candidates were built in, so the first fitting one is the answer.
    return fitting[0]!;
  }

  // Nothing fitted. The smallest is better than no sheet, and `withinBudget`
  // false is how the caller knows it is over.
  return candidates.reduce((a, b) => (b.bytes < a.bytes ? b : a));
}
