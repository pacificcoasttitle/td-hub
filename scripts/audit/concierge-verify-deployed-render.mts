/**
 * READ-ONLY. Did the DEPLOYED build embed the fonts?
 *
 * EVIDENCE_RULES rule 3: a local render is evidence about the renderer, never
 * about production. Everything proving Montserrat and Work Sans embed so far
 * is a local render. The deployed function is a different filesystem with a
 * different bundle, and `outputFileTracingIncludes` is a claim about that
 * bundle that nothing local can check.
 *
 * The failure this exists to catch is silent. If the TTFs are missing from the
 * function, registerDocumentFonts() throws — but if anything catches that, or
 * if a future change swaps the throw for a fallback, react-pdf renders eight
 * entirely reasonable pages of Helvetica and no check fails.
 *
 * HOW TO USE IT. The render routes need a session, so a script cannot trigger
 * them (and must not: no shared secret that skips getSession). So:
 *
 *   1. On the DEPLOYED app, re-render the profile — /reports, row action,
 *      "Try again". Free: it reads the stored payload and calls no vendor.
 *   2. Run this. It reads the PDF the deployed function just wrote to S3 and
 *      counts the embedded font subsets in it.
 *
 * It compares against the row's own template_version and pdf_generated_at, so
 * reading a stale PDF from before the re-render is reported rather than
 * mistaken for a pass.
 *
 *   npx tsx --env-file=.env.local scripts/audit/concierge-verify-deployed-render.mts
 */
import { eq } from 'drizzle-orm';
import { db } from '../../src/lib/db/client';
import { conciergeProfiles } from '../../src/lib/db/schema/concierge';
import { downloadFile } from '../../src/lib/integrations/s3/client';
import { TEMPLATE_VERSION } from '../../src/lib/domain/concierge/document/profile-document';
import { FONT_FILES } from '../../src/lib/domain/concierge/document/fonts';

const FAMILIES = [...new Set(FONT_FILES.map((f) => f.family.replace(/\s+/g, '')))];

(async () => {
  const rows = await db.select().from(conciergeProfiles).orderBy(conciergeProfiles.id);
  console.log(`\n${rows.length} profile(s). Expecting template ${TEMPLATE_VERSION}.\n`);

  let anyStale = false;
  let anyHelvetica = false;

  for (const p of rows) {
    console.log(`── profile ${p.id} · ${p.requestedAddress}, ${p.requestedCity}`);
    if (!p.pdfStorageKey) {
      console.log('   no stored PDF\n');
      continue;
    }
    const got = await downloadFile(p.pdfStorageKey);
    if (!got.success || !got.data) {
      console.log('   PDF unreadable from storage\n');
      continue;
    }
    const pdf = got.data.toString('latin1');
    const subsets = (pdf.match(/FontFile2/g) ?? []).length;
    const counts = FAMILIES.map((f) => [f, (pdf.match(new RegExp(f, 'g')) ?? []).length] as const);
    const helvetica = (pdf.match(/Helvetica/g) ?? []).length;
    const pages = (pdf.match(/\/Type\s*\/Page[^s]/g) ?? []).length;

    const stale = p.templateVersion !== TEMPLATE_VERSION;
    if (stale) anyStale = true;
    if (helvetica > 0) anyHelvetica = true;

    console.log(`   template ${p.templateVersion}${stale ? `  <- STALE, not re-rendered on ${TEMPLATE_VERSION}` : ''}`);
    // There is no rendered-at column. pdfKey() puts the render time in the
    // object key itself (profile-2026-09-29T17-00-00-000Z.pdf), which is
    // better evidence than a column anyway: it belongs to the object.
    const stamp = /profile-(\d{4}-\d{2}-\d{2}T[\d-]+)Z?\.pdf$/.exec(p.pdfStorageKey)?.[1]
      ?.replace('T', ' ').replace(/-(\d{2})-(\d{2})-(\d{3})$/, ':$1:$2') ?? 'unknown';
    console.log(`   rendered ${stamp}   ${pages} pages   ${(got.data.length / 1024).toFixed(0)} KB`);
    console.log(`   embedded font subsets: ${subsets}`);
    for (const [family, n] of counts) console.log(`     ${family.padEnd(12)} ${n} references`);
    console.log(`     ${'Helvetica'.padEnd(12)} ${helvetica} references${helvetica > 0 ? '  <- FALLBACK, the fonts did not load' : ''}`);
    console.log(`   verdict: ${stale ? 'NOT RE-RENDERED YET' : subsets === 0 || helvetica > 0 ? 'FAIL — no embedded fonts' : 'PASS'}\n`);
  }

  console.log('─'.repeat(70));
  if (anyStale) {
    console.log('Some profiles are not on the current template. Re-render them on the');
    console.log('DEPLOYED app first — this reads what is in storage, and a PDF written');
    console.log('by a local run proves nothing about the deployed bundle.');
  }
  if (anyHelvetica) {
    console.log('HELVETICA IS PRESENT. The deployed function did not find the TTFs.');
    console.log('Check outputFileTracingIncludes in next.config.ts.');
  }
  if (!anyStale && !anyHelvetica) {
    console.log('All profiles on the current template with embedded fonts and no Helvetica.');
  }
  process.exit(anyHelvetica ? 1 : 0);
})().catch((e) => { console.error('FAILED:', e instanceof Error ? e.message : String(e)); process.exit(1); });
