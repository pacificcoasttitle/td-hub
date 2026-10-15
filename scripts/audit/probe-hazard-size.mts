/**
 * READ ONLY, NO VENDOR CALL. What does the hazard sheet cost in megabytes, and
 * does JPEG buy the document back without visibly costing legibility?
 *
 * The 300dpi raster took profile 42 from 1.26 MB to 6.43 MB — the sheet is
 * five times the rest of the document. These profiles are emailed, so that is
 * a real number, not a tidiness point.
 *
 * PNG is lossless and was the obvious first choice; it is also the wrong
 * compression for a page that is half aerial photography. This measures the
 * alternatives rather than assuming one.
 *
 *   npx tsx scripts/audit/probe-hazard-size.mts <some.pdf>
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { rasterizeFirstPage } from '../../src/lib/domain/concierge/rasterize-pdf';

(async () => {
  const path = process.argv.slice(2).find((a) => !a.startsWith('-'));
  if (!path) throw new Error('usage: probe-hazard-size.mts <some.pdf>');

  const sharp = (await import('sharp')).default;
  mkdirSync('_scratch_untracked', { recursive: true });

  for (const dpi of [200, 300]) {
    const r = await rasterizeFirstPage(readFileSync(path), { dpi });
    if (!r.ok) { console.log(`${dpi}dpi failed: ${r.detail}`); continue; }
    console.log(`\n=== ${dpi} dpi — ${r.width} x ${r.height}px ===`);
    console.log(`  png            ${(r.png.length / 1_048_576).toFixed(2)} MB`);
    writeFileSync(`_scratch_untracked/hazard-${dpi}.png`, r.png);

    for (const quality of [92, 85, 75]) {
      const jpeg = await sharp(r.png).jpeg({ quality, chromaSubsampling: '4:4:4' }).toBuffer();
      console.log(
        `  jpeg q${quality}        ${(jpeg.length / 1_048_576).toFixed(2)} MB`
        + `   (${Math.round((jpeg.length / r.png.length) * 100)}% of the PNG)`,
      );
      writeFileSync(`_scratch_untracked/hazard-${dpi}-q${quality}.jpg`, jpeg);
    }
  }
  // 4:4:4 on purpose: the default 4:2:0 throws away colour resolution, which
  // is where thin coloured rules and the green parcel outline live. The saving
  // is not worth blurring the one mark that says which parcel it is.
  console.log('\nLook at the files before choosing. Size is only half the question.\n');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
