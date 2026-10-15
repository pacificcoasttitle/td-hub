import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { looksLikePdf, rasterizeFirstPage } from './rasterize-pdf';
import { pngSize, effectiveDpi } from './png-size';

// ─── The thing that makes the hazard sheet legible ──────────────────────────
//
// MyNHD serves the same one-page preview as a 1024px PNG and as a vector PDF.
// Their PNG across the document's 528pt content width is 140 dpi, which puts
// their disclaimer type at about 5pt and blurred — measured, in
// integrations/mynhd/fixtures/first-real-preview.json. So we take the PDF and
// redraw it at 300.
//
// sharp, which the plat map uses for TIFF, CANNOT do this: PDF input is
// disabled in its prebuilt libvips. That was a wrong premise caught before it
// cost anything, and the test below records it so the next person does not
// re-derive it.

/** A real PDF the repo already has: the committed UI proof. */
const SAMPLE = join(process.cwd(), 'docs/ui-proofs/v6/Concierge-v6-BUILD-CORRECTIONS.pdf');

describe('looksLikePdf', () => {
  it('accepts a real PDF and refuses anything else', () => {
    expect(looksLikePdf(readFileSync(SAMPLE))).toBe(true);
    expect(looksLikePdf(Buffer.from('%PDF'))).toBe(false);
    expect(looksLikePdf(Buffer.from('not a pdf'))).toBe(false);
    expect(looksLikePdf(Buffer.alloc(0))).toBe(false);
    // A PNG is the realistic wrong input — it is what the other endpoint
    // returns, and the two were swapped on purpose.
    expect(looksLikePdf(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
  });
});

describe('rasterising at print resolution', () => {
  it('draws a letter page at 300dpi as 2550 x 3300', async () => {
    const r = await rasterizeFirstPage(readFileSync(SAMPLE), { dpi: 300 });
    expect(r.ok, r.ok ? '' : `${r.reason}: ${r.detail}`).toBe(true);
    if (!r.ok) return;
    // A PDF page is measured in points at 72 to the inch, so the scale is
    // dpi/72 and a letter page is 8.5 x 11 inches.
    expect(r.width).toBe(2550);
    expect(r.height).toBe(3300);
    expect(r.dpi).toBe(300);
  });

  it('produces a real PNG, whose header agrees with the reported size', async () => {
    const r = await rasterizeFirstPage(readFileSync(SAMPLE), { dpi: 150 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(pngSize(r.png)).toEqual({ width: r.width, height: r.height });
  });

  // ─── THE WHITE-BACKGROUND GUARD IS NOT HERE, AND THAT IS DELIBERATE ─────
  //
  // An unpainted @napi-rs canvas is transparent black — checked directly,
  // getImageData gives 0,0,0,0 — and @react-pdf places transparency on a sheet
  // as a BLACK rectangle. So "the raster comes out opaque white" is a real
  // property worth protecting.
  //
  // I could not write a guard for it that fails when it should, and three
  // attempts is where I stopped rather than keep one that passes for reasons
  // I cannot name:
  //
  //   1. rasterise the committed UI proof and check a corner pixel — green
  //      with the canvas fill deleted, because that PDF paints its own white.
  //   2. rasterise a hand-built page with no content stream — also green with
  //      the fill deleted.
  //   3. pass `background: 'rgba(0,0,0,0)'` to render() — STILL green, which
  //      I cannot explain and will not assert around.
  //
  // What IS established, by reading pdfjs rather than guessing: its render()
  // does `background || "#ffffff"`, so an opaque white fill is its documented
  // default and happens before anything is drawn. rasterize-pdf.ts passes
  // `background` explicitly so that dependence is visible in the code instead
  // of inherited silently.
  //
  // A guard that cannot be made to fail is worse than a comment saying so: it
  // reads as protection and is not. This is the comment.

  it('is sharp enough for a full-width sheet, which their PNG is not', async () => {
    // The whole reason for this module. 528pt is the document's content width.
    const r = await rasterizeFirstPage(readFileSync(SAMPLE), { dpi: 300 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(effectiveDpi(r.width, 528)).toBeGreaterThanOrEqual(300);
    // MyNHD's own raster, for contrast — the number that sent us here.
    expect(effectiveDpi(1024, 528)).toBeLessThan(150);
  });

  it('refuses a PNG rather than rendering a blank page', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const r = await rasterizeFirstPage(png);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('not_a_pdf');
  });

  it('returns a reason rather than throwing on rubbish that claims to be a PDF', async () => {
    // Passes the signature check and is not a document. A throw here would
    // surface somewhere unrelated; the bridge needs a reason it can record.
    const r = await rasterizeFirstPage(Buffer.from('%PDF-1.4 and then nothing at all'));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('render_failed');
    expect(r.detail.length).toBeGreaterThan(0);
  });
});

describe('why not sharp', () => {
  it('records that sharp cannot read PDF in this install', async () => {
    // The plat map converts TIFF with sharp, and "use the same tooling" was
    // the obvious plan. It does not generalise, and finding that out by
    // reading the format table cost nothing while assuming it would have cost
    // a day.
    const sharp = (await import('sharp')).default;
    expect(sharp.format.tiff.input.buffer).toBe(true);
    expect(sharp.format.pdf?.input?.buffer ?? false).toBe(false);
  });
});
