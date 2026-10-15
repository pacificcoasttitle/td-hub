import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SHEET_JPEG_LADDER, SHEET_MAX_BYTES, __resetRasterizerHealthForTests, encodeForSheet,
  looksLikePdf, rasterizeFirstPage, rasterizerHealth,
} from './rasterize-pdf';
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

// ─── The sheet has a size it must live inside ───────────────────────────────
//
// These profiles get emailed. Gerard, 15 Oct 2026: the whole profile under
// 3 MB. The 300dpi PNG took profile 42 from 1.26 MB to 6.43 MB, and PNG is
// the wrong compression for a page that is half aerial photography.

describe('encoding the sheet', () => {
  it('prefers lossless PNG when it is no larger — JPEG is not always smaller', async () => {
    // THE ASSUMPTION THIS TEST KILLED. "The page is photographic, so JPEG"
    // was about to be applied to every page. On this one — a flat-colour
    // document of navy bands, white and type — the 300dpi PNG is ~632 KB and
    // JPEG q92 is ~706 KB. Larger, and lossy.
    const r = await rasterizeFirstPage(readFileSync(SAMPLE), { dpi: 300 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const sharp = (await import('sharp')).default;
    const jpeg = await sharp(r.png).jpeg({ quality: 92, chromaSubsampling: '4:4:4' }).toBuffer();
    expect(jpeg.length).toBeGreaterThan(r.png.length);

    const e = await encodeForSheet(r.png);
    expect(e.contentType).toBe('image/png');
    expect(e.quality).toBeNull();
  });

  it('comes in under the budget', async () => {
    const r = await rasterizeFirstPage(readFileSync(SAMPLE), { dpi: 300 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const e = await encodeForSheet(r.png);
    expect(e.withinBudget).toBe(true);
    expect(e.bytes).toBeLessThanOrEqual(SHEET_MAX_BYTES);
  });

  it('falls to JPEG when the PNG does not fit, highest quality first', async () => {
    const r = await rasterizeFirstPage(readFileSync(SAMPLE), { dpi: 300 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // A budget under the PNG forces the ladder, and the top rung that fits
    // wins — fidelity is the goal, the budget is only the constraint.
    const e = await encodeForSheet(r.png, { maxBytes: r.png.length - 1 });
    expect(e.contentType).toBe('image/jpeg');
    expect([e.buffer[0], e.buffer[1]]).toEqual([0xff, 0xd8]);
    expect(SHEET_JPEG_LADDER).toContain(e.quality!);
    expect(e.bytes).toBeLessThanOrEqual(r.png.length - 1);
  });

  it('steps further down as the budget tightens', async () => {
    const r = await rasterizeFirstPage(readFileSync(SAMPLE), { dpi: 300 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const loose = await encodeForSheet(r.png, { maxBytes: r.png.length - 1 });
    const tight = await encodeForSheet(r.png, { maxBytes: loose.bytes - 1 });
    expect(tight.quality!).toBeLessThan(loose.quality!);
    expect(tight.bytes).toBeLessThan(loose.bytes);
  });

  it('still returns an image when nothing fits, and SAYS it did not fit', async () => {
    // A sheet slightly over budget beats no sheet — but silently shipping one
    // while a caller believes the budget held is how a 6 MB document happens.
    const r = await rasterizeFirstPage(readFileSync(SAMPLE), { dpi: 300 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const e = await encodeForSheet(r.png, { maxBytes: 1_000 });
    expect(e.withinBudget).toBe(false);
    expect(e.bytes).toBeGreaterThan(1_000);
    // The smallest thing on offer, so "did not fit" still means "tried".
    expect(e.quality).toBe(SHEET_JPEG_LADDER[SHEET_JPEG_LADDER.length - 1]);
  });
});

// ─── The health check must actually rasterise ───────────────────────────────
//
// Its first version loaded @napi-rs/canvas, drew on a 2x2 canvas, and called
// that a pass — reasoning that the native binary is the only part that can
// differ between a laptop and Vercel, and that pdfjs "cannot fail to resolve".
//
// It reported rasterizer:true on a deploy that could not rasterise. pdfjs
// resolved exactly as predicted; its WORKER did not, because pdfjs loads that
// with a dynamic import of a runtime path that Next had not traced. The check
// proved the half that was not at risk.

describe('rasterizerHealth', () => {
  beforeEach(() => { __resetRasterizerHealthForTests(); });

  it('passes here, where the worker is present', async () => {
    const h = await rasterizerHealth();
    expect(h.ok, h.detail).toBe(true);
    expect(h.detail).toBeUndefined();
  });

  it('FAILS when rasterisation fails — it is not a proxy check', async () => {
    // THE PROPERTY THAT WAS MISSING, and the reason the seam exists. The real
    // failure was pdfjs's worker absent from the traced bundle, which cannot
    // be reproduced in-process — so the rasteriser is injected and made to
    // fail exactly as the deploy did.
    const failing: typeof rasterizeFirstPage = async () => ({
      ok: false,
      reason: 'render_failed',
      detail: 'Setting up fake worker failed: Cannot find module pdf.worker.mjs',
    });
    const h = await rasterizerHealth(failing);
    expect(h.ok).toBe(false);
    // And it carries the real words, which is what somebody needs to fix it.
    expect(h.detail).toContain('fake worker');
  });

  it('passes the WHOLE operation, not a canvas smoke test', async () => {
    // The first version drew on a 2x2 canvas and called it a pass. What it is
    // given must be a real PDF that is really parsed and drawn.
    let seen: Buffer | null = null;
    const spy: typeof rasterizeFirstPage = async (pdf, opts) => {
      seen = pdf;
      return rasterizeFirstPage(pdf, opts);
    };
    const h = await rasterizerHealth(spy);
    expect(h.ok).toBe(true);
    expect(seen).not.toBeNull();
    expect(looksLikePdf(seen!)).toBe(true);
  });

  it('is cached per process, so a poll does not re-parse a PDF', async () => {
    const first = await rasterizerHealth();
    const second = await rasterizerHealth();
    // Same object identity: the second call did no work at all.
    expect(second).toBe(first);
  });
});
