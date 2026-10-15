/**
 * READ ONLY, NO VENDOR CALL. Measure the hazard PNG already stored on a
 * profile, and write it out as the fixture.
 *
 * The companion to mynhd-measure-preview.ts, which makes the call itself. This
 * one is for the case that actually happened: an operator clicked the row
 * action, the preview was fetched and stored by the DEPLOYED FUNCTION, and the
 * bytes are in S3 with the dimensions on the row. Measuring those is strictly
 * better evidence than a fresh call from a laptop — it is the image the
 * document will embed.
 *
 *   npx tsx --env-file=.env.local scripts/audit/mynhd-measure-stored.ts [profileId]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { desc, eq, isNotNull } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { conciergeProfiles } from '@/lib/db/schema/concierge';
import { downloadFile } from '@/lib/integrations/s3/client';
import { effectiveDpi, pngSize } from '@/lib/domain/concierge/png-size';

/** Letter, less parts.ts's SIDE on each edge. */
const LETTER_W_PT = 612;
const LETTER_H_PT = 792;
const SIDE_PT = 42;
const CONTENT_W_PT = LETTER_W_PT - SIDE_PT * 2;

/** Roughly what a sheet has left under the band and above the footer. */
const BAND_H_PT = 54;
const FOOTER_H_PT = 40;
const SECTION_BAR_PT = 26;
const FOOTNOTE_PT = 34;
const USABLE_H_PT = LETTER_H_PT - BAND_H_PT - FOOTER_H_PT - SECTION_BAR_PT - FOOTNOTE_PT;

const OUT_PNG = 'docs/vendor-reports/mynhd/first-real-preview.png';
const OUT_JSON = 'src/lib/integrations/mynhd/fixtures/first-real-preview.json';

async function main() {
  const arg = Number(process.argv[2]);
  const wanted = Number.isInteger(arg) && arg > 0 ? arg : null;

  const [p] = await db
    .select({
      id: conciergeProfiles.id,
      address: conciergeProfiles.requestedAddress,
      city: conciergeProfiles.requestedCity,
      apn: conciergeProfiles.subjectApn,
      fips: conciergeProfiles.subjectFips,
      key: conciergeProfiles.hazardStorageKey,
      width: conciergeProfiles.hazardWidth,
      height: conciergeProfiles.hazardHeight,
      bytes: conciergeProfiles.hazardBytes,
      sha: conciergeProfiles.hazardSha256,
      orderLink: conciergeProfiles.hazardOrderLink,
      status: conciergeProfiles.hazardStatus,
      httpStatus: conciergeProfiles.hazardHttpStatus,
      success: conciergeProfiles.hazardSuccess,
    })
    .from(conciergeProfiles)
    .where(wanted !== null ? eq(conciergeProfiles.id, wanted) : isNotNull(conciergeProfiles.hazardStorageKey))
    .orderBy(desc(conciergeProfiles.id))
    .limit(1);

  if (!p?.key) {
    console.error(wanted !== null
      ? `Profile ${wanted} has no stored hazard PNG.`
      : 'No profile has a stored hazard PNG.');
    process.exit(1);
  }

  console.log(`\n=== profile ${p.id} — ${p.address}, ${p.city ?? ''} ===`);
  console.log(`  APN ${p.apn}  FIPS ${p.fips}`);
  console.log(`  hazard_status : ${p.status}`);
  console.log(`  vendor said   : http ${p.httpStatus}  success=${p.success}`);
  console.log(`  order link    : ${p.orderLink ?? '(none)'}`);
  console.log(`  row says      : ${p.width} x ${p.height} px, ${p.bytes} bytes`);

  const got = await downloadFile(p.key);
  if (!got.success || !got.data) {
    console.error(`\nCould not read ${p.key} from storage.`);
    process.exit(1);
  }
  const png = got.data;

  // Measured from the bytes, not trusted from the row. The row was written by
  // the same code being checked.
  const size = pngSize(png);
  const sha = createHash('sha256').update(png).digest('hex');
  console.log('\n=== measured from the bytes ===');
  console.log(`  pixels : ${size ? `${size.width} x ${size.height}` : 'UNREADABLE'}`);
  console.log(`  bytes  : ${png.length.toLocaleString()}`);
  console.log(`  sha256 : ${sha}`);
  console.log(`  row agrees: ${size?.width === p.width && size?.height === p.height && png.length === p.bytes}`);
  console.log(`  digest agrees: ${sha === p.sha}`);

  if (!size) process.exit(1);

  const aspect = size.width / size.height;
  const fullWidthHeight = CONTENT_W_PT / aspect;
  const dpiFullWidth = effectiveDpi(size.width, CONTENT_W_PT);
  const widthFor300 = Math.round((size.width / 300) * 72);
  const widthFor150 = Math.round((size.width / 150) * 72);
  // The widest it can be drawn and still fit the sheet's remaining height.
  const widthForHeightFit = Math.round(USABLE_H_PT * aspect);

  console.log('\n=== what that means for the sheet ===');
  console.log(`  content width        : ${CONTENT_W_PT}pt`);
  console.log(`  usable height        : ~${USABLE_H_PT}pt (letter less band, section bar, footnote, footer)`);
  console.log(`  aspect               : ${aspect.toFixed(3)} (${aspect < 1 ? 'portrait' : 'landscape'})`);
  console.log(`  drawn at full width  : ${CONTENT_W_PT} x ${Math.round(fullWidthHeight)}pt`);
  console.log(`  fits the height?     : ${fullWidthHeight <= USABLE_H_PT ? 'yes' : `NO — ${Math.round(fullWidthHeight - USABLE_H_PT)}pt too tall`}`);
  console.log(`  dpi at full width    : ${dpiFullWidth}`);
  console.log(`  for 300dpi, max width: ${widthFor300}pt`);
  console.log(`  for 150dpi, max width: ${widthFor150}pt`);
  console.log(`  to fit the height    : ${widthForHeightFit}pt wide`);
  console.log(
    dpiFullWidth >= 300 ? '\n  VERDICT: print quality at full width.'
      : dpiFullWidth >= 150 ? '\n  VERDICT: usable, under the 300dpi print floor. A narrower draw is sharper.'
        : '\n  VERDICT: BELOW 150dpi at full width. Do not stretch it to fill the sheet.',
  );

  for (const path of [OUT_PNG, OUT_JSON]) mkdirSync(dirname(path), { recursive: true });
  writeFileSync(OUT_PNG, png);
  console.log(`\nwrote ${OUT_PNG}  (look at it)`);

  const fixture = {
    _comment: [
      'PROVISIONAL. The first real MyNHD preview, fetched by the DEPLOYED function',
      'on 2026-10-15 with the DEV key against api.mynhd.com — the only base URL',
      'MyNHD has given us. Dev may serve sample data, so these dimensions are not',
      'final: re-measure when the production key arrives before the layout is.',
      'image_data is not stored here; the bytes are in the PNG beside it and',
      'sha256 identifies them.',
    ],
    provisional: true,
    measuredAt: new Date().toISOString(),
    profileId: p.id,
    apn: p.apn,
    fips: p.fips,
    httpStatus: p.httpStatus,
    success: p.success,
    order_link: p.orderLink,
    png: {
      bytes: png.length,
      width: size.width,
      height: size.height,
      sha256: sha,
      aspect: Number(aspect.toFixed(4)),
      contentWidthPt: CONTENT_W_PT,
      dpiAtContentWidth: dpiFullWidth,
      widthPtFor300Dpi: widthFor300,
      drawnHeightAtFullWidthPt: Math.round(fullWidthHeight),
    },
  };
  writeFileSync(OUT_JSON, `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`wrote ${OUT_JSON}`);
  console.log('');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
