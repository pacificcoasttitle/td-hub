/**
 * ONE real MyNHD call, measured. Run this before the hazard sheet's layout exists.
 *
 * ─── WHY THE LAYOUT WAITS FOR THIS ──────────────────────────────────────────
 *
 * The spec (docs/vendor-reports/mynhd/CONCIERGE_MYNHD_PREVIEW.md) says to
 * measure the PNG's pixel dimensions on the first real response before
 * committing to a layout, because a preview sized for a web page may be too
 * soft to print across a letter sheet. That is not a stylistic worry: a 600px
 * image stretched over 528 points of page prints at 82 dpi, which looks fine
 * on a screen and visibly fuzzy on paper — and scaling it up to fill the sheet
 * makes it worse, not better.
 *
 * So this reports the numbers the layout needs, and writes the response as the
 * fixture the guards will use. Running it is the step that unblocks the page.
 *
 * ─── WHAT IT COSTS ──────────────────────────────────────────────────────────
 *
 * Nothing. Gerard, 12 Oct 2026: MyNHD's preview is free to PCT. One auth POST
 * and one preview POST against somebody else's service, which is why this
 * defaults to a SINGLE profile and will not loop over the table.
 *
 * ─── WHAT IT TOUCHES ────────────────────────────────────────────────────────
 *
 * READ ONLY on the database, and it does NOT write to S3 or update the profile.
 * It reads one profile's APN and FIPS and writes two local files. Adding the
 * preview to a profile for real is the route's job, not a script's.
 *
 *   npx tsx --env-file=.env.local scripts/audit/mynhd-measure-preview.ts        # picks a profile
 *   npx tsx --env-file=.env.local scripts/audit/mynhd-measure-preview.ts 12     # a specific one
 *
 * MYNHD_SECRET_KEY must be present. It is in the Vercel environment; to run
 * this locally, `npx vercel env pull` or set it in the shell for one command.
 * The key is never printed, logged or written to a file by this script.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { and, desc, isNotNull, eq, ne } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { conciergeProfiles } from '@/lib/db/schema/concierge';
import { fetchFloodFirePreview } from '@/lib/integrations/mynhd/client';
import { getConfig } from '@/lib/integrations/mynhd/auth';
import { effectiveDpi, pngSize } from '@/lib/domain/concierge/png-size';

/** The document's own content width: letter, less parts.ts's SIDE on each edge. */
const LETTER_W_PT = 612;
const SIDE_PT = 42;
const CONTENT_W_PT = LETTER_W_PT - SIDE_PT * 2;

const OUT_PNG = 'docs/vendor-reports/mynhd/first-real-preview.png';
const OUT_JSON = 'src/lib/integrations/mynhd/fixtures/first-real-preview.json';

async function main() {
  if (!getConfig()) {
    console.error(
      'MYNHD_SECRET_KEY is not set, so no call was made.\n'
      + 'It lives in the Vercel environment. Pull it with `npx vercel env pull`,\n'
      + 'or set it for one command. Do not paste it into a file.',
    );
    process.exit(1);
  }

  const arg = Number(process.argv[2]);
  const wanted = Number.isInteger(arg) && arg > 0 ? arg : null;

  const [profile] = await db
    .select({
      id: conciergeProfiles.id,
      address: conciergeProfiles.requestedAddress,
      city: conciergeProfiles.requestedCity,
      state: conciergeProfiles.requestedState,
      apn: conciergeProfiles.subjectApn,
      fips: conciergeProfiles.subjectFips,
      county: conciergeProfiles.subjectCounty,
    })
    .from(conciergeProfiles)
    .where(wanted !== null
      ? eq(conciergeProfiles.id, wanted)
      // Any profile that actually carries a parcel. Newest first, because the
      // newest payloads are the ones whose shape we have been reading.
      : and(isNotNull(conciergeProfiles.subjectApn), isNotNull(conciergeProfiles.subjectFips), ne(conciergeProfiles.subjectApn, '')))
    .orderBy(desc(conciergeProfiles.id))
    .limit(1);

  if (!profile) {
    console.error(wanted !== null ? `Profile ${wanted} not found.` : 'No profile has both an APN and a FIPS.');
    process.exit(1);
  }
  if (!profile.apn?.trim() || !profile.fips?.trim()) {
    console.error(`Profile ${profile.id} has apn=${JSON.stringify(profile.apn)} fips=${JSON.stringify(profile.fips)} — both are required.`);
    process.exit(1);
  }

  console.log(`=== profile ${profile.id} ===`);
  console.log(`  ${profile.address}, ${profile.city ?? ''} ${profile.state ?? ''}`);
  console.log(`  APN ${profile.apn}   FIPS ${profile.fips}   ${profile.county ?? ''}`);
  console.log('\nasking MyNHD for one flood-and-fire PNG preview (free)…\n');

  const r = await fetchFloodFirePreview({
    apn: profile.apn, fips: profile.fips, state: (profile.state ?? 'CA').toUpperCase(),
  });

  // The evidence either way. A 200 with success:false is a multi-match, not an
  // error, and the distinction has to survive into the output.
  console.log('=== what MyNHD said ===');
  console.log(`  http status : ${r.evidence?.httpStatus ?? '(no response)'}`);
  console.log(`  success     : ${JSON.stringify(r.evidence?.success ?? null)}`);
  console.log(`  code        : ${JSON.stringify(r.evidence?.code ?? null)}`);
  console.log(`  error       : ${JSON.stringify(r.evidence?.error ?? null)}`);
  console.log(`  re-authed   : ${r.evidence?.reAuthed ?? false}`);
  console.log(`  duration    : ${r.durationMs}ms`);

  if (!r.ok) {
    console.log(`\nNO PREVIEW — ${r.reason}\n  ${r.message}`);
    console.log('\nNothing was charged. The layout stays unwritten until a real PNG has been measured.');
    process.exit(1);
  }

  const size = pngSize(r.png);
  console.log('\n=== the PNG ===');
  console.log(`  bytes       : ${r.png.length.toLocaleString()}`);
  console.log(`  pixels      : ${size ? `${size.width} x ${size.height}` : 'UNREADABLE HEADER'}`);
  console.log(`  order link  : ${r.orderLink ?? '(none sent)'}`);

  if (size) {
    const aspect = size.width / size.height;
    const atContentWidth = effectiveDpi(size.width, CONTENT_W_PT);
    const drawnHeightPt = Math.round(CONTENT_W_PT / aspect);
    console.log('\n=== what that means for the sheet ===');
    console.log(`  content width        : ${CONTENT_W_PT}pt (letter 612 less 42 each side)`);
    console.log(`  aspect ratio         : ${aspect.toFixed(3)} (${aspect > 1 ? 'landscape' : 'portrait'})`);
    console.log(`  drawn full width     : ${CONTENT_W_PT} x ${drawnHeightPt}pt`);
    console.log(`  effective resolution : ${atContentWidth} dpi`);
    console.log(
      atContentWidth >= 300 ? '  VERDICT: print quality at full width.'
        : atContentWidth >= 150 ? '  VERDICT: acceptable, below the 300dpi print floor. Consider a narrower draw.'
          : '  VERDICT: TOO SOFT at full width. Do not stretch it — draw it smaller, or use the PDF endpoint.',
    );
    // The height that would be needed to keep 300dpi, as the alternative to
    // stating a verdict and leaving the reader to do the arithmetic.
    const widthPtFor300 = Math.round((size.width / 300) * 72);
    console.log(`  for 300 dpi, draw it at most ${widthPtFor300}pt wide`);
  }

  for (const path of [OUT_PNG, OUT_JSON]) mkdirSync(dirname(path), { recursive: true });

  writeFileSync(OUT_PNG, r.png);
  console.log(`\nwrote ${OUT_PNG}  (look at it)`);

  // ─── The fixture, WITHOUT the image bytes ─────────────────────────────────
  //
  // The response shape is what the guards need; a megabyte of base64 in a test
  // fixture is a megabyte nobody reads. The PNG is beside it as a real file, and
  // its digest ties the two together.
  const fixture = {
    _comment: [
      'The first real MyNHD preview response, from scripts/audit/mynhd-measure-preview.ts.',
      'image_data is REPLACED by its measurements — the bytes are in',
      `${OUT_PNG}, and sha256 identifies them.`,
    ],
    profileId: profile.id,
    apn: profile.apn,
    fips: profile.fips,
    httpStatus: r.evidence.httpStatus,
    success: r.evidence.success,
    order_link: r.orderLink,
    png: {
      bytes: r.png.length,
      width: size?.width ?? null,
      height: size?.height ?? null,
      sha256: await sha256(r.png),
      effectiveDpiAtContentWidth: size ? effectiveDpi(size.width, CONTENT_W_PT) : null,
      contentWidthPt: CONTENT_W_PT,
    },
  };
  writeFileSync(OUT_JSON, `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`wrote ${OUT_JSON}`);
  console.log('\nCommit both, then write the sheet against these numbers.');
  process.exit(0);
}

async function sha256(buf: Buffer): Promise<string> {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(buf).digest('hex');
}

main().catch((e) => { console.error(e); process.exit(1); });
