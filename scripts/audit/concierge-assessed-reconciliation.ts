/**
 * Run the SHIPPED parser over every stored tax payload and report what the
 * assessed-total guard decides.
 *
 * FREE. Reads title_point_data. No vendor call, no TitlePoint charge.
 *
 * WHY THIS AND NOT THE MEASUREMENT THAT SET THE TOLERANCE. The tolerance was
 * chosen from an ad-hoc query that reimplemented the arithmetic inline. That
 * query is not the code that will render a document, and a guard is only worth
 * having if the thing actually shipping behaves the way the measurement said.
 * So this imports parseTitlePointTaxResult itself.
 *
 * The number to watch is `mismatch`: those are the profiles that will print a
 * land/improvement split and no total. If it climbs, the vendor's arithmetic has
 * changed and that is a finding, not a rendering quirk.
 *
 * The TaxReport is trimmed in SQL before it crosses the wire — the image, legal
 * and cross-reference blocks are most of the bytes and the parser reads none of
 * them.
 *
 *   npx tsx --env-file=.env.local scripts/audit/concierge-assessed-reconciliation.ts
 */
import { sql } from 'drizzle-orm';
import { db } from '../../src/lib/db/client';
import { parseTitlePointTaxResult, melloRoosLines } from '../../src/lib/domain/concierge/titlepoint-tax-report';
import { taxReportHasContent } from '../../src/lib/domain/concierge/document/derive';

type Basis = 'stated' | 'verified' | 'unverifiable' | 'mismatch' | 'absent';

async function main() {
  const rows = await db.execute(sql`
    select
      id,
      fips,
      (metadata->'resultData'->'TaxReport')
        - 'PropertyImages' - 'PropertyImageTypes' - 'UnderlyingLegalInfos'
        - 'UnderlyingPropertyXrefs' - 'LegalInfos' - 'SearchAsPointers'
        - 'AssessedOwners' - 'MailingNames' - 'TransferOwners' - 'Image'
        - 'DocumentInformation' - 'Parcels' - 'UnderlyingParcels'
        as tr
    from title_point_data
    where search_type = 'tax'
      and metadata ? 'resultData'
      and jsonb_typeof(metadata->'resultData'->'TaxReport') = 'object'
    order by id desc
  `) as unknown as Array<{ id: number; fips: string | null; tr: Record<string, unknown> }>;

  console.log(`stored tax payloads: ${rows.length}\n`);

  const basis = new Map<Basis, number>();
  const mismatches: Array<{ id: number; expected: number; stated: number; off: string }> = [];
  let parsed = 0, unparsed = 0, withContent = 0, mello = 0;
  let installmentsBoth = 0, assessments = 0;

  for (const row of rows) {
    const result = parseTitlePointTaxResult({ TaxReport: row.tr });
    if (!result) { unparsed++; continue; }
    parsed++;

    const b = result.assessed.basis;
    basis.set(b, (basis.get(b) ?? 0) + 1);

    if (b === 'mismatch' && result.assessed.expectedTax !== null && result.assessed.statedTax !== null) {
      const e = result.assessed.expectedTax;
      const s = result.assessed.statedTax;
      if (mismatches.length < 15) {
        mismatches.push({ id: row.id, expected: e, stated: s, off: `${(((e - s) / s) * 100).toFixed(1)}%` });
      }
    }

    if (taxReportHasContent(result.report)) withContent++;
    if (result.report.installments.length >= 2) installmentsBoth++;
    if (result.report.specialAssessments.length > 0) assessments++;
    if (melloRoosLines({ TaxReport: row.tr }).length > 0) mello++;
  }

  const pct = (n: number) => `${((n / parsed) * 100).toFixed(1)}%`;

  console.log('=== assessed total: what the guard decides ===');
  for (const b of ['verified', 'mismatch', 'unverifiable', 'absent', 'stated'] as Basis[]) {
    const n = basis.get(b) ?? 0;
    console.log(`  ${b.padEnd(14)} ${String(n).padStart(5)}  ${pct(n)}`);
  }

  console.log('\n=== the rest of layer 1 ===');
  console.log(`  parsed                     ${parsed}  (${unparsed} not a tax result)`);
  console.log(`  earns a page (has content) ${withContent}  ${pct(withContent)}`);
  console.log(`  both installments          ${installmentsBoth}  ${pct(installmentsBoth)}`);
  console.log(`  direct assessments present ${assessments}  ${pct(assessments)}`);
  console.log(`  Mello-Roos line present    ${mello}  ${pct(mello)}`);

  if (mismatches.length > 0) {
    console.log('\n=== mismatches: a split will print, no total (first 15) ===');
    for (const m of mismatches) {
      console.log(`  #${String(m.id).padEnd(7)} expected $${m.expected.toFixed(2).padStart(12)}  stated $${m.stated.toFixed(2).padStart(12)}  off ${m.off}`);
    }
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
