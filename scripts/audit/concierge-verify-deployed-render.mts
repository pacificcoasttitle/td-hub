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

  /**
   * The first template that registers Montserrat and Work Sans.
   *
   * ONLY A FONT-BEARING TEMPLATE CAN FAIL A FONT CHECK. v1 and v2 render in
   * Helvetica because that is what they were built to do, and the first
   * version of this summary counted their Helvetica as evidence that the
   * deployed function could not find the TTFs. It printed "HELVETICA IS
   * PRESENT — the deployed function did not find the TTFs" on a run whose own
   * per-profile verdicts included a PASS with 137 embedded subsets.
   *
   * A checker that cries wolf gets muted, and a muted checker is how the
   * verify gate stayed red for a month.
   */
  const FONTS_FROM = 3;
  const templateNum = (v: string | null) => Number(/^v(\d+)$/.exec(v ?? '')?.[1] ?? '0');

  let anyStale = false;
  const fontProof: number[] = [];
  const fontFailures: number[] = [];

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

    // Judged only where fonts were expected.
    const fontBearing = templateNum(p.templateVersion) >= FONTS_FROM;
    const fontsOk = subsets > 0 && helvetica === 0;
    if (fontBearing) (fontsOk ? fontProof : fontFailures).push(p.id);

    console.log(`   template ${p.templateVersion}${stale ? `  <- STALE, not re-rendered on ${TEMPLATE_VERSION}` : ''}`);
    // There is no rendered-at column. pdfKey() puts the render time in the
    // object key itself (profile-2026-09-29T17-00-00-000Z.pdf), which is
    // better evidence than a column anyway: it belongs to the object.
    const stamp = /profile-(\d{4}-\d{2}-\d{2}T[\d-]+)Z?\.pdf$/.exec(p.pdfStorageKey)?.[1]
      ?.replace('T', ' ').replace(/-(\d{2})-(\d{2})-(\d{3})$/, ':$1:$2') ?? 'unknown';
    console.log(`   rendered ${stamp}   ${pages} pages   ${(got.data.length / 1024).toFixed(0)} KB`);
    console.log(`   embedded font subsets: ${subsets}`);
    for (const [family, n] of counts) console.log(`     ${family.padEnd(12)} ${n} references`);
    console.log(`     ${'Helvetica'.padEnd(12)} ${helvetica} references${helvetica > 0 && fontBearing ? '  <- FALLBACK, the fonts did not load' : helvetica > 0 ? '  (expected — this template predates the fonts)' : ''}`);

    const verdict = !fontBearing
      ? `template predates the fonts — nothing to prove${stale ? ', and stale' : ''}`
      : fontsOk
        ? `FONTS EMBEDDED${stale ? ' (but on an older template)' : ''}`
        : 'FAIL — a font-bearing template with no embedded fonts';
    console.log(`   verdict: ${verdict}\n`);
  }

  console.log('─'.repeat(70));

  // THE FONT QUESTION AND THE TEMPLATE QUESTION ARE SEPARATE, and answering
  // them together is what made this summary lie. One font-bearing PDF in
  // storage settles the font question for good: nothing local writes to the
  // database, so a stored PDF with embedded subsets came from the deployed
  // function. Stale templates are tidiness, not evidence.
  if (fontProof.length > 0) {
    console.log(`FONTS CONFIRMED IN THE DEPLOYED FUNCTION — profile ${fontProof.join(', ')}.`);
    console.log('A stored PDF carrying embedded subsets can only have been written by');
    console.log('production: nothing rendered locally reaches this database.');
  } else if (fontFailures.length > 0) {
    console.log(`FONTS MISSING — profile ${fontFailures.join(', ')} is on a font-bearing`);
    console.log('template with no embedded subsets. Check outputFileTracingIncludes.');
  } else {
    console.log('NOT YET ANSWERED. No profile has been rendered on a font-bearing');
    console.log(`template (v${FONTS_FROM} or later), so there is nothing to read.`);
  }

  if (fontFailures.length > 0 && fontProof.length > 0) {
    console.log(`\nMIXED: profile ${fontFailures.join(', ')} failed while ${fontProof.join(', ')} passed.`);
  }

  if (anyStale) {
    console.log(`\n${rows.filter((p) => p.templateVersion !== TEMPLATE_VERSION).length} profile(s) are not on ${TEMPLATE_VERSION}. Re-rendering them is free and`);
    console.log('moves them onto the current layout — worth doing, but it proves nothing');
    console.log('that the line above has not already settled.');
  }
  // Non-zero ONLY for a real font failure. A stale template is not a failure,
  // and exiting non-zero on one is how a checker gets ignored.
  process.exit(fontFailures.length > 0 ? 1 : 0);
})().catch((e) => { console.error('FAILED:', e instanceof Error ? e.message : String(e)); process.exit(1); });
