/**
 * READ ONLY, NO VENDOR CALL, WRITES NOTHING TO PRODUCTION.
 *
 * Renders a real profile twice — with and without the hazard sheet — and
 * writes both PDFs locally, so the sheet can be LOOKED AT rather than inferred
 * from a passing test.
 *
 * The hazard image is a STAND-IN: any PDF rasterised at 300dpi by the same
 * code the bridge uses. That proves the layout — placement after the property
 * details, full width, no band, the footnote, the footer, the numbering —
 * without needing a MyNHD key on this machine. What it cannot prove is how
 * MyNHD's own page looks at that size; that needs a real fetch on the deployed
 * function.
 *
 * RELATIVE IMPORTS, AND A .mts, deliberately. `@/` aliases send tsx through
 * its CJS resolver, and @react-pdf/textkit's import of
 * `@react-pdf/hyphenate/en-us` has no `require` condition — the script dies
 * with ERR_PACKAGE_PATH_NOT_EXPORTED before it renders anything. The same
 * reason concierge-render-preview.mts is written this way.
 *
 *   npx tsx --env-file=.env.local scripts/audit/probe-hazard-sheet.mts <profileId> <stand-in.pdf>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { db } from '../../src/lib/db/client';
import { conciergeProfiles, conciergeProfileComps } from '../../src/lib/db/schema/concierge';
import { downloadFile } from '../../src/lib/integrations/s3/client';
import { DEFAULT_CRITERIA, selectComps, type CompCriteria } from '../../src/lib/domain/concierge/comp-filter';
import { computeMetrics } from '../../src/lib/domain/concierge/metrics';
import { toDataUri } from '../../src/lib/domain/concierge/platmap';
import { ProfileDocument } from '../../src/lib/domain/concierge/document/profile-document';
import { compFromRow } from '../../src/lib/domain/concierge/comp-row';
import { subjectFactsFromRow } from '../../src/lib/domain/concierge/subject-facts';
import { normalizeSubject, normalizeTax, normalizeTransfers } from '../../src/lib/domain/concierge/normalize';
import { rasterizeFirstPage } from '../../src/lib/domain/concierge/rasterize-pdf';

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

async function loadImage(key: string | null): Promise<string | null> {
  if (!key) return null;
  const got = await downloadFile(key);
  return got.success && got.data ? toDataUri(got.data) : null;
}

(async () => {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const id = Number(args[0]);
  const standIn = args[1];
  if (!Number.isInteger(id) || !standIn) {
    throw new Error('usage: probe-hazard-sheet.mts <profileId> <stand-in.pdf>');
  }

  const [profile] = await db.select().from(conciergeProfiles).where(eq(conciergeProfiles.id, id)).limit(1);
  if (!profile) throw new Error(`No profile ${id}`);
  if (!profile.rawStorageKey) throw new Error(`Profile ${id} has no stored payload`);
  console.log(`\nprofile ${id}: ${profile.requestedAddress}, ${profile.requestedCity ?? ''}`);

  const applied: CompCriteria = {
    sameUseCode: profile.criteriaSameUseCode,
    livingAreaPct: profile.criteriaLivingAreaPct,
    bedDelta: profile.criteriaBedDelta,
    bathDelta: profile.criteriaBathDelta,
    radiusMiles: num(profile.criteriaRadiusMiles),
    months: profile.criteriaMonths,
    maxComps: profile.criteriaMaxComps ?? DEFAULT_CRITERIA.maxComps,
  };

  const storedComps = await db.select().from(conciergeProfileComps)
    .where(eq(conciergeProfileComps.profileId, id))
    .orderBy(conciergeProfileComps.sourcePosition);
  const now = new Date();
  const filter = selectComps(storedComps.map(compFromRow), subjectFactsFromRow(profile), applied, now);
  const metrics = computeMetrics(filter.selected, applied);

  const raw = await downloadFile(profile.rawStorageKey);
  if (!raw.success || !raw.data) throw new Error('Stored payload unreadable');
  const feed = (JSON.parse(raw.data.toString('utf8')) as { Feed?: Record<string, unknown> }).Feed ?? {};

  // The stand-in, through the REAL rasteriser at the REAL dpi.
  const raster = await rasterizeFirstPage(readFileSync(standIn), { dpi: 300 });
  if (!raster.ok) throw new Error(`rasterise failed: ${raster.detail}`);
  console.log(`stand-in: ${raster.width} x ${raster.height}px at ${raster.dpi}dpi, ${raster.png.length.toLocaleString()} bytes`);
  const hazardImage = `data:image/png;base64,${raster.png.toString('base64')}`;

  const { renderToBuffer } = await import('@react-pdf/renderer');
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');

  for (const withHazard of [true, false]) {
    const buf = await renderToBuffer(ProfileDocument({
      subject: normalizeSubject(feed), tax: normalizeTax(feed), transfers: normalizeTransfers(feed),
      filter, metrics, criteria: applied,
      taxReport: (profile.taxReport as Parameters<typeof ProfileDocument>[0]['taxReport']) ?? null,
      compMapImage: await loadImage(profile.compMapStorageKey),
      platMapImage: await loadImage(profile.platmapStorageKey),
      platMapStatus: profile.platmapStatus,
      hazardImage: withHazard ? hazardImage : null,
      preparedFor: { name: profile.preparedForName ?? '', company: profile.preparedForCompany ?? null },
      presentingRep: {
        name: profile.presentingRepName ?? '', email: profile.presentingRepEmail,
        phone: profile.presentingRepPhone, title: profile.presentingRepTitle,
      },
      generatedAt: now,
      capturedAt: profile.sitexRequestedAt ?? null,
      sitexSearchId: profile.sitexSearchId ?? null,
    }));

    const out = join(process.cwd(), '_scratch_untracked', `hazard-${id}-${withHazard ? 'with' : 'without'}.pdf`);
    writeFileSync(out, buf);

    // Read it back rather than trusting that it rendered.
    const doc = await getDocument({ data: new Uint8Array(buf), verbosity: 0 }).promise;
    const sheets: string[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const c = await (await doc.getPage(p)).getTextContent();
      sheets.push(c.items.map((i) => ('str' in i ? i.str : '')).join('').replace(/\s+/g, ''));
    }
    const at = sheets.findIndex((t) => t.includes('Naturalhazardpreview'));
    const details = sheets.findIndex((t) => t.includes('OWNER,ADDRESS'));
    console.log(
      `\n  ${withHazard ? 'WITH' : 'WITHOUT'}: ${doc.numPages} sheets, `
      + `${(buf.length / 1_048_576).toFixed(2)} MB  -> ${out}`,
    );
    console.log(`    hazard sheet at page : ${at < 0 ? 'ABSENT' : at + 1}`);
    if (at >= 0) {
      const t = sheets[at]!;
      console.log(`    right after details  : ${at === details + 1}   (details on ${details + 1})`);
      console.log(`    navy band present    : ${t.includes('CONCIERGEPROPERTYPROFILE')}   (must be false)`);
      console.log(`    PCT footer present   : ${t.includes('Datadeemedreliable')}   (must be true)`);
      console.log(`    page number present  : ${/\d+of\d+/.test(t)}   (must be true)`);
      console.log(`    order link printed   : ${t.toLowerCase().includes('ffprevorder')}   (must be false)`);
    }
  }
  console.log('');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
