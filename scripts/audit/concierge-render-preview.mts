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
  const id = Number(process.argv[2] ?? '4');
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
  const all = pages.join(' ');

  console.log(`\nProfile ${id} — ${profile.requestedAddress}, ${profile.requestedCity}`);
  console.log(`  stored template: ${profile.templateVersion}   this render: ${TEMPLATE_VERSION}`);
  console.log(`  pages: ${doc.numPages}   bytes: ${buf.length.toLocaleString()}`);
  console.log(`  comps: ${filter.selected.length} of ${filter.counts.qualified} qualifying`);
  console.log(`  written to ${out}\n`);

  console.log('  Page headings:');
  pages.forEach((t, i) => console.log(`    ${i + 1}. ${t.trim().slice(0, 74).replace(/\s+/g, ' ')}`));

  console.log('\n  Checks against the real payload:');
  const checks: [string, boolean][] = [
    ['tax page present', /Property\s*tax/i.test(all)],
    ['no payment status anywhere', !/delinquent/i.test(all)],
    ['no valuation of this property', !/(Estimated value|Midpoint|suggest it)/i.test(all)],
    ['subject sale renders (not the no-sale callout)', !/No subject sale on record/i.test(all)],
    ['supplied price per sq ft present', /Price per sf/i.test(all)],
    ['template stamped v3', new RegExp(`Template\\s*${TEMPLATE_VERSION}`).test(all)],
    ['disclaimer gap visible', /disclaimer pending/i.test(all)],
  ];
  for (const [label, ok] of checks) console.log(`    ${ok ? 'PASS' : 'FAIL'}  ${label}`);

  process.exit(0);
})().catch((e) => { console.error('FAILED:', e instanceof Error ? e.message : String(e)); process.exit(1); });
