/**
 * READ ONLY, NO VENDOR CALL. Does pdfjs + @napi-rs/canvas actually rasterise a
 * PDF at 300dpi on this machine?
 *
 * The whole hazard-sheet plan rests on it, and sharp — which the plat map uses
 * — turned out not to read PDF at all. So this proves the tooling on a PDF we
 * already have before any of it is wired in.
 *
 *   npx tsx scripts/audit/probe-rasterize.ts <some.pdf>
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { rasterizeFirstPage, looksLikePdf } from '@/lib/domain/concierge/rasterize-pdf';
import { pngSize, effectiveDpi } from '@/lib/domain/concierge/png-size';

const CONTENT_W_PT = 528;

async function main() {
  const path = process.argv[2];
  if (!path) { console.error('usage: probe-rasterize.ts <some.pdf>'); process.exit(1); }

  const pdf = readFileSync(path);
  console.log(`\nsource: ${path}  ${pdf.length.toLocaleString()} bytes  looksLikePdf=${looksLikePdf(pdf)}`);

  for (const dpi of [150, 300]) {
    const started = Date.now();
    const r = await rasterizeFirstPage(pdf, { dpi });
    const took = Date.now() - started;
    if (!r.ok) {
      console.log(`  ${dpi}dpi: FAILED (${r.reason}) ${r.detail}`);
      continue;
    }
    const size = pngSize(r.png);
    console.log(
      `  ${dpi}dpi: ${r.width} x ${r.height}px, ${r.png.length.toLocaleString()} bytes, ${took}ms`
      + `  header says ${size?.width}x${size?.height}`
      + `  -> ${effectiveDpi(r.width, CONTENT_W_PT)} dpi at ${CONTENT_W_PT}pt`,
    );
    mkdirSync('_scratch_untracked', { recursive: true });
    const out = `_scratch_untracked/rasterized-${dpi}dpi.png`;
    writeFileSync(out, r.png);
    console.log(`         wrote ${out}`);
  }

  // The negative: a PNG must be refused rather than rendered as a blank page.
  const notPdf = Buffer.from('this is not a pdf at all, it is a sentence');
  const bad = await rasterizeFirstPage(notPdf);
  console.log(`\n  non-PDF input: ok=${bad.ok} reason=${bad.ok ? '-' : bad.reason}`);
  console.log('');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
