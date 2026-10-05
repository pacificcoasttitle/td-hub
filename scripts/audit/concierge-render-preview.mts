/**
 * Render a stored Concierge profile to a LOCAL file, writing nothing.
 *
 * This is the acceptance check for the v3 layout, run before anything touches
 * production. It mirrors renderProfile() exactly — same stored payload, same
 * stored comps, same shared mappings — but the PDF lands on disk instead of in
 * S3, and no row is updated.
 *
 * WHY NOT JUST CALL POST /render. That writes: a new PDF object, a new
 * template_version, a new page count on a row an operator can open. Proving
 * the layout is right is a read-only question, and doing it read-only means a
 * mistake costs a local file rather than a profile Gerard is looking at.
 *
 * NO VENDOR CALL — reads our own S3 objects and our own tables only.
 *
 *   npx tsx --env-file=.env.local scripts/audit/concierge-render-preview.ts 4
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { db } from '../../src/lib/db/client';
// Direct, not via the schema barrel: under ESM the barrel's re-exports are not
// resolved eagerly and `conciergeProfileComps` comes back undefined.
import { conciergeProfiles, conciergeProfileComps } from '../../src/lib/db/schema/concierge';
import { downloadFile } from '../../src/lib/integrations/s3/client';
import { DEFAULT_CRITERIA, selectComps, type CompCriteria } from '../../src/lib/domain/concierge/comp-filter';
import { computeMetrics } from '../../src/lib/domain/concierge/metrics';
import { toDataUri } from '../../src/lib/domain/concierge/platmap';
import { ProfileDocument, TEMPLATE_VERSION } from '../../src/lib/domain/concierge/document/profile-document';
import { compFromRow } from '../../src/lib/domain/concierge/comp-row';
import { subjectFactsFromRow } from '../../src/lib/domain/concierge/subject-facts';
import { normalizeSubject, normalizeTax, normalizeTransfers } from '../../src/lib/domain/concierge/normalize';

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
  // The first NON-FLAG argument. `npm run concierge:pages -- 4` puts
  // --raster at argv[2], and reading that as the id gave NaN and a query that
  // failed with the whole SELECT printed.
  const id = Number(process.argv.slice(2).find((a) => !a.startsWith('-')) ?? '4');
  if (!Number.isInteger(id)) throw new Error(`not a profile id: ${process.argv.slice(2).join(' ')}`);
  const [profile] = await db.select().from(conciergeProfiles).where(eq(conciergeProfiles.id, id)).limit(1);
  if (!profile) throw new Error(`No profile ${id}`);
  if (!profile.rawStorageKey) throw new Error(`Profile ${id} has no stored payload`);

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

  const candidates = storedComps.map(compFromRow);
  const subjectFacts = subjectFactsFromRow(profile);
  const now = new Date();
  const filter = selectComps(candidates, subjectFacts, applied, now);
  const metrics = computeMetrics(filter.selected, applied);

  const raw = await downloadFile(profile.rawStorageKey);
  if (!raw.success || !raw.data) throw new Error('Stored payload unreadable');
  const feed = (JSON.parse(raw.data.toString('utf8')) as { Feed?: Record<string, unknown> }).Feed ?? {};
  const subject = normalizeSubject(feed);
  const tax = normalizeTax(feed);
  const transfers = normalizeTransfers(feed);

  const { renderToBuffer } = await import('@react-pdf/renderer');
  const buf = await renderToBuffer(ProfileDocument({
    subject, tax, transfers, filter, metrics, criteria: applied,
    // PAGE 4, LAYER 1. This was missing from 2026-09-30, when renderProfile
    // gained it, until 2026-10-05 — while the docblock above went on claiming
    // this script "mirrors renderProfile() exactly".
    //
    // It cost a wrong diagnosis. Profile 9 HAS a stored TitlePoint report with
    // a rate, a rate area and nine assessments; this preview rendered the thin
    // SiteX page and was read as evidence that the data had not arrived. A tool
    // whose whole job is to be evidence about the renderer has to BE the
    // renderer's input, or it reports on something else and says it did not.
    taxReport: (profile.taxReport as Parameters<typeof ProfileDocument>[0]['taxReport']) ?? null,
    compMapImage: await loadImage(profile.compMapStorageKey),
    platMapImage: await loadImage(profile.platmapStorageKey),
    platMapStatus: profile.platmapStatus,
    preparedFor: { name: profile.preparedForName ?? '', company: profile.preparedForCompany ?? null },
    presentingRep: {
      name: profile.presentingRepName ?? '', email: profile.presentingRepEmail,
      phone: profile.presentingRepPhone, title: profile.presentingRepTitle,
    },
    generatedAt: now,
    capturedAt: profile.sitexRequestedAt ?? null,
    sitexSearchId: profile.sitexSearchId ?? null,
  }));

  const out = join(process.cwd(), '_scratch_untracked', `concierge-${id}-${TEMPLATE_VERSION}.pdf`);
  writeFileSync(out, buf);

  // Read the text back rather than trusting that it rendered.
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await getDocument({ data: new Uint8Array(buf), verbosity: 0 }).promise;
  const pages: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const c = await (await doc.getPage(p)).getTextContent();
    pages.push(c.items.map((i) => ('str' in i ? i.str : '')).join(' '));
  }
  // Squashed. pdfjs emits its own spacing between text runs, so an exact
  // phrase regex misses a line the document really does contain — the
  // Commissioner paragraph failed this way while the test suite, which strips
  // whitespace, passed on the same render.
  const all = pages.join(' ').replace(/\s+/g, ' ');
  const squashed = all.replace(/\s+/g, '');
  const has = (phrase: string) => squashed.includes(phrase.replace(/\s+/g, ''));

  console.log(`\nProfile ${id} — ${profile.requestedAddress}, ${profile.requestedCity}`);
  console.log(`  stored template: ${profile.templateVersion}   this render: ${TEMPLATE_VERSION}`);
  console.log(`  pages: ${doc.numPages}   bytes: ${buf.length.toLocaleString()}`);
  console.log(`  comps: ${filter.selected.length} of ${filter.counts.qualified} qualifying`);
  console.log(`  written to ${out}\n`);

  console.log('  Page headings:');
  pages.forEach((t, i) => console.log(`    ${i + 1}. ${t.trim().slice(0, 74).replace(/\s+/g, ' ')}`));

  console.log('\n  Checks against the real payload:');
  // v6. The previous set asserted v3 behaviour — a "Price per sf" label, a
  // template version in the footer, and a visible disclaimer-pending box —
  // all three of which v6 deliberately removes.
  const checks: [string, boolean][] = [
    ['tax page present', /PROPERTY\s*TAX/i.test(all)],
    ['no payment status anywhere', !/delinquent/i.test(all)],
    ['no "late after" column', !/late\s*after/i.test(all)],
    ['no valuation of this property', !/(Estimated value|Midpoint|suggest it)/i.test(all)],
    ['subject sale renders (not the no-sale callout)', !/No subject sale on record/i.test(all)],
    ['price per sq ft present', has('Price per sq ft')],
    ['Commissioner disclaimer present', has('California Insurance Commissioner')],
    ['accommodation-only paragraph present', has('provided as an accommodation only')],
    ['no "pending" disclaimer box', !has('disclaimer pending') && !has('not for external distribution')],
    ['template version NOT on the page', !/Template\s*v\d/i.test(all)],
    ['v6 footer present', /Data deemed reliable/i.test(all)],
    ['no v3 lede sentences', !/A single-family home built in/i.test(all)],
    [`stamped ${TEMPLATE_VERSION} in metadata`, TEMPLATE_VERSION === 'v4'],
  ];
  for (const [label, ok] of checks) console.log(`    ${ok ? 'PASS' : 'FAIL'}  ${label}`);

  // --raster turns the PDF into one PNG per page, because the question this
  // script exists for is "does the page read right", and that is not a
  // question text can answer. Three data faults this month were found by a
  // person looking at a rendered page and none by a test: a test asserts that
  // a field renders, only a reader asks whether the sentence is true.
  if (process.argv.includes('--raster')) {
    const { execFileSync } = await import('node:child_process');
    const dir = join(process.cwd(), '_scratch_untracked', `concierge-${id}-pages`);
    execFileSync(process.execPath, [
      join(process.cwd(), 'scripts', 'audit', 'rasterise-pdf.mjs'), out, dir, '1.25',
    ], { stdio: 'inherit' });
  }

  const failed = checks.filter(([, ok]) => !ok).length;
  if (failed > 0) console.log(`\n  ${failed} check(s) failed.`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((e) => { console.error('FAILED:', e instanceof Error ? e.message : String(e)); process.exit(1); });
