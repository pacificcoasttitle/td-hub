/**
 * Rasterise a PDF's pages to PNGs, so a layout can be LOOKED AT rather than
 * inferred from extracted text.
 *
 * AGENTS.md: "When the question is 'can a person see this?', the answer is not
 * in the source." The same applies to a design spec — a transcription tells you
 * the numbers, and the page tells you whether the result reads right.
 *
 *   node scripts/audit/rasterise-pdf.mjs <input.pdf> <outDir> [scale]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const [input, outDir, scaleArg] = process.argv.slice(2);
if (!input || !outDir) {
  console.error('usage: rasterise-pdf.mjs <input.pdf> <outDir> [scale]');
  process.exit(1);
}
const scale = Number(scaleArg ?? 1.5);

mkdirSync(outDir, { recursive: true });

const doc = await getDocument({
  data: new Uint8Array((await import('node:fs')).readFileSync(input)),
  verbosity: 0,
}).promise;

const stem = basename(input).replace(/\.pdf$/i, '');
console.log(`${doc.numPages} pages at scale ${scale}`);

for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p);
  const vp = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
  const ctx = canvas.getContext('2d');
  // White behind the page: a PDF with no background paints onto transparent,
  // which renders as black in most viewers and hides light text entirely.
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
  const out = join(outDir, `${stem}-p${String(p).padStart(2, '0')}.png`);
  writeFileSync(out, canvas.toBuffer('image/png'));
  console.log(`  ${out}  ${Math.ceil(vp.width)}x${Math.ceil(vp.height)}`);
}
