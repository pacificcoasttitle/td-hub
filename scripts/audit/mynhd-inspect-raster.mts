/**
 * READ ONLY, NO VENDOR CALL. Pull a profile's stored hazard raster and say
 * whether there is anything on it.
 *
 * Page 4 renders with its footer and footnote and a blank body. There are
 * exactly two places that can happen — pdfjs drew nothing, or react-pdf did
 * not place what pdfjs drew — and the stored raster tells you which in one
 * step. react-pdf renders an unresolvable <Image> src as EMPTY rather than
 * failing, which is why "blank" is not self-explaining.
 *
 * Writes the file to _scratch_untracked so it can be looked at, and reports
 * ink coverage so "blank" is a measurement rather than an impression.
 *
 *   npx tsx --env-file=.env.local scripts/audit/mynhd-inspect-raster.mts [profileId]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { desc, eq, isNotNull } from 'drizzle-orm';
import { db } from '../../src/lib/db/client';
import { conciergeProfiles } from '../../src/lib/db/schema/concierge';
import { downloadFile } from '../../src/lib/integrations/s3/client';

(async () => {
  const arg = Number(process.argv.slice(2).find((a) => !a.startsWith('-')));
  const wanted = Number.isInteger(arg) && arg > 0 ? arg : null;

  const [p] = await db
    .select({
      id: conciergeProfiles.id,
      address: conciergeProfiles.requestedAddress,
      status: conciergeProfiles.hazardStatus,
      key: conciergeProfiles.hazardStorageKey,
      pdfKey: conciergeProfiles.hazardPdfStorageKey,
      width: conciergeProfiles.hazardWidth,
      height: conciergeProfiles.hazardHeight,
      bytes: conciergeProfiles.hazardBytes,
      sha: conciergeProfiles.hazardSha256,
      dpi: conciergeProfiles.hazardDpi,
    })
    .from(conciergeProfiles)
    .where(wanted !== null ? eq(conciergeProfiles.id, wanted) : isNotNull(conciergeProfiles.hazardStorageKey))
    .orderBy(desc(conciergeProfiles.id))
    .limit(1);

  if (!p?.key) throw new Error(wanted ? `profile ${wanted} has no stored raster` : 'no profile has one');

  console.log(`\n=== profile ${p.id} — ${p.address} ===`);
  console.log(`  status : ${p.status}`);
  console.log(`  raster : ${p.key}`);
  console.log(`  pdf    : ${p.pdfKey ?? '(none archived)'}`);
  console.log(`  row    : ${p.width} x ${p.height}, ${p.bytes} bytes, dpi=${p.dpi}`);

  const got = await downloadFile(p.key);
  if (!got.success || !got.data) throw new Error(`could not read ${p.key}`);
  const buf = got.data;

  mkdirSync('_scratch_untracked', { recursive: true });
  const ext = p.key.endsWith('.jpg') ? 'jpg' : 'png';
  const out = `_scratch_untracked/raster-${p.id}.${ext}`;
  writeFileSync(out, buf);

  console.log('\n=== the bytes as stored ===');
  console.log(`  size   : ${buf.length.toLocaleString()} bytes  (row says ${p.bytes})`);
  console.log(`  sha256 : ${createHash('sha256').update(buf).digest('hex')}`);
  console.log(`  row sha: ${p.sha}`);
  console.log(`  magic  : ${JSON.stringify(buf.subarray(0, 4).toString('latin1'))}`);
  console.log(`  wrote  : ${out}`);

  const sharp = (await import('sharp')).default;
  const meta = await sharp(buf).metadata();
  console.log('\n=== what the image actually is ===');
  console.log(`  format : ${meta.format}`);
  console.log(`  pixels : ${meta.width} x ${meta.height}`);
  console.log(`  channels: ${meta.channels}  hasAlpha: ${meta.hasAlpha}`);

  // ─── IS THERE ANY INK ON IT ──────────────────────────────────────────────
  //
  // "Blank" has to be a measurement. stats gives per-channel min/max and mean
  // over the whole image: an all-white page has min 255 on every channel, and
  // a mean of 255. Anything drawn pulls the minimum down and the mean below.
  const stats = await sharp(buf).stats();
  console.log('\n=== ink ===');
  for (const [i, c] of stats.channels.entries()) {
    console.log(`  channel ${i}: min=${c.min} max=${c.max} mean=${c.mean.toFixed(2)}`);
  }
  const allWhite = stats.channels.every((c) => c.min === 255);
  const nearWhite = stats.channels.every((c) => c.mean > 253);
  console.log(`\n  every channel min 255 (pure blank) : ${allWhite}`);
  console.log(`  every channel mean > 253 (near blank): ${nearWhite}`);
  console.log(
    allWhite ? '\n  VERDICT: the raster is BLANK. pdfjs drew nothing.'
      : nearWhite ? '\n  VERDICT: all but blank — a trace of ink, nothing readable.'
        : '\n  VERDICT: the raster HAS CONTENT. The blank page is downstream of it.',
  );
  console.log('');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
