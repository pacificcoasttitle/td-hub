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
