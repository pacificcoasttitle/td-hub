/**
 * Print a PDF's text, page by page.
 *
 *   node scripts/audit/pdf-text.mjs <file.pdf> [fromPage] [toPage]
 */
import { readFileSync } from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const file = process.argv[2];
if (!file) { console.error('usage: pdf-text.mjs <file.pdf> [from] [to]'); process.exit(1); }

const doc = await getDocument({ data: new Uint8Array(readFileSync(file)), verbosity: 0 }).promise;
const from = Number(process.argv[3] ?? 1);
const to = Number(process.argv[4] ?? doc.numPages);
console.log(`pages: ${doc.numPages}`);
for (let p = from; p <= Math.min(to, doc.numPages); p++) {
  const c = await (await doc.getPage(p)).getTextContent();
  console.log(`\n───── page ${p} ─────`);
  console.log(c.items.map((i) => ('str' in i ? i.str : '')).join(' ').replace(/[ \t]+/g, ' ').trim());
}
