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
 * A real one-page PDF, small enough to live in a string.
 *
 * It has a content stream that draws a filled rectangle, so rasterising it
 * exercises the actual path — parse, worker, canvas, encode — rather than a
 * document pdfjs could short-circuit.
 */
const TINY_PDF = Buffer.from([
  '%PDF-1.4',
  '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
  '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 9 9]/Contents 4 0 R>>endobj',
  '4 0 obj<</Length 44>>stream',
  '0 0 1 rg 1 1 7 7 re f',
  'endstream',
  'endobj',
  'trailer<</Size 5/Root 1 0 R>>',
  '%%EOF',
  '',
].join('\n'), 'latin1');

let cached: { ok: boolean; detail?: string } | null = null;

/** Visible for tests. The per-process cache otherwise leaks between them. */
export function __resetRasterizerHealthForTests(): void {
  cached = null;
}

/**
 * Can this deploy rasterise at all?
 *
 * ─── IT RASTERISES. IT DOES NOT CHECK A PROXY FOR RASTERISING ───────────────
 *
 * The first version loaded @napi-rs/canvas, drew on a 2x2 canvas and called
 * that a pass. The reasoning was that the native binary is the only part that
 * can differ between a Windows laptop and Vercel's Linux runtime, and that
 * "pdfjs is plain JavaScript and cannot fail to resolve".
 *
 * IT REPORTED `rasterizer: true` ON A DEPLOY THAT COULD NOT RASTERISE. The
 * module resolved exactly as predicted; its WORKER did not, because pdfjs
 * loads that with a dynamic import of a runtime path and Next had not traced
 * the file:
 *
 *   Setting up fake worker failed: "Cannot find module
 *   '/var/task/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'"
 *
 * So the check proved the half that was not at risk and skipped the half that
 * was — a green light over a broken feature, which is the thing this codebase
 * spends its time removing. The only honest check is the whole operation on a
 * real document.
 *
 * CACHED PER PROCESS. The answer is a property of the deployment and cannot
 * change under a running instance, so the first health call pays for it and
 * the rest are free — and a poll every few seconds does not re-parse a PDF.
 */
export async function rasterizerHealth(
  /**
   * The rasteriser, injectable ONLY so that the red path is provable.
   *
   * A health check that cannot be shown to go red is a green light. The
   * failure this exists for — pdfjs's worker missing from the traced bundle —
   * cannot be reproduced in-process, and spying on a dynamic import's
   * namespace does not reach the binding. A default parameter is the smallest
   * seam that lets a test assert the thing that actually went wrong.
   */
  raster: typeof rasterizeFirstPage = rasterizeFirstPage,
): Promise<{ ok: boolean; detail?: string }> {
  if (cached) return cached;
  try {
    const r = await raster(TINY_PDF, { dpi: 72 });
    cached = r.ok
      ? { ok: true }
      : { ok: false, detail: `${r.reason}: ${r.detail}`.slice(0, 200) };
  } catch (err) {
    cached = { ok: false, detail: err instanceof Error ? err.message.slice(0, 200) : 'unknown' };
  }
  return cached;
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
