/**
 * What does a real TitlePoint tax result actually look like?
 *
 * FREE. Reads title_point_data only — no vendor call, no TitlePoint charge.
 * These payloads were bought months ago for real orders; this is the "a fixture
 * is a real stored payload" rule applied to the Concierge tax parser, which
 * otherwise would be written against the field names in a document.
 *
 * Prints the key shape across many rows rather than one row's keys, because a
 * single payload cannot tell you which fields are optional — and the parser has
 * to know that before it decides what a missing field means.
 *
 *   npx tsx --env-file=.env.local scripts/audit/concierge-tax-report-shape.ts
 */
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { db } from '../../src/lib/db/client';
import { titlePointData } from '../../src/lib/db/schema';

const LIMIT = 60;

interface Leaf { present: number; filled: number; sample: string }

/**
 * PRESENT AND FILLED ARE COUNTED SEPARATELY, because this payload answers
 * absence with an empty string rather than by omitting the key. TaxReport.Bonds
 * is `""` on all 58 rows; a script that counted keys would report it as always
 * present, which is true and useless. Only `filled` says whether a field can be
 * rendered.
 */
function walk(v: unknown, path: string, out: Map<string, Leaf>) {
  if (v === null || v === undefined) return;
  if (Array.isArray(v)) {
    for (const item of v) walk(item, `${path}[]`, out);
    return;
  }
  if (typeof v === 'object') {
    for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
      walk(child, path ? `${path}.${k}` : k, out);
    }
    return;
  }
  const s = String(v).trim();
  const filled = s !== '' && s !== '0.00' && s !== '0.000000';
  const prev = out.get(path);
  out.set(path, {
    present: (prev?.present ?? 0) + 1,
    filled: (prev?.filled ?? 0) + (filled ? 1 : 0),
    sample: prev?.filled ? prev.sample : (filled ? s.slice(0, 40) : prev?.sample ?? ''),
  });
}

async function main() {
  const rows = await db
    .select({ id: titlePointData.id, metadata: titlePointData.metadata })
    .from(titlePointData)
    .where(and(
      eq(titlePointData.searchType, 'tax'),
      isNotNull(titlePointData.metadata),
    ))
    .orderBy(desc(titlePointData.id))
    .limit(LIMIT);

  const withResult = rows.filter((r) => {
    const m = (r.metadata as Record<string, unknown>) ?? {};
    return !!m.resultData;
  });

  console.log(`tax rows read: ${rows.length} · carrying resultData: ${withResult.length}`);
  if (withResult.length === 0) {
    console.log('\nNo stored tax result to read. The parser cannot be built from a real payload.');
    process.exit(0);
  }

  const leaves = new Map<string, Leaf>();
  for (const r of withResult) {
    const rd = (r.metadata as Record<string, unknown>).resultData;
    walk(rd, '', leaves);
  }

  const n = withResult.length;
  const sorted = [...leaves.entries()].sort((a, b) => b[1].filled - a[1].filled || a[0].localeCompare(b[0]));

  console.log(`\n=== TaxReport scalar fields, FILLED / present, across ${n} payloads ===`);
  for (const [path, l] of sorted) {
    if (path.includes('[]')) continue; // repeated items get their own section
    console.log(`  ${String(l.filled).padStart(3)}/${String(l.present).padEnd(3)}  ${path}  ${JSON.stringify(l.sample)}`);
  }

  console.log('\n=== repeated items ===');
  for (const [path, l] of sorted) {
    if (!path.includes('[]')) continue;
    if (!/Installments|Liens|SpecialAssess|Bond|Supplement/i.test(path)) continue;
    console.log(`  ${String(l.filled).padStart(4)}/${String(l.present).padEnd(4)}  ${path}  ${JSON.stringify(l.sample)}`);
  }

  // NAMED EXACTLY, not regex-matched. The regex version of this check reported
  // "assessed value ✓ CountSpecialAssessments" and "tax rate ✓
  // ApplyAuditorTaxRate" — a keyword detector will always find something, and
  // what it finds is not the answer. The same class of mistake as the first
  // concierge-tax-fields-available.ts.
  console.log(`\n=== the fields page 4 needs, by exact name (filled / ${n}) ===`);
  const NEEDS: Array<[string, string[]]> = [
    ['tax year', ['TaxReport.TaxYear', 'TaxReport.Installments.Item[].TaxYear']],
    ['annual amount', ['TaxReport.TotalTax', 'TaxReport.CurrentYearTotalAmount']],
    ['assessed value', ['TaxReport.AssessedValuation', 'TaxReport.TotalValuation', 'TaxReport.AssessedValuation2']],
    ['land value', ['TaxReport.LandValuation']],
    ['improvement value', ['TaxReport.ImprovementsValuation', 'TaxReport.ImprovementValuation']],
    ['tax rate', ['TaxReport.TaxRate', 'TaxReport.CalculatedTaxRate']],
    ['tax rate area', ['TaxReport.TaxRateArea']],
    ['installment amount', ['TaxReport.Installments.Item[].Amount']],
    ['installment due date', ['TaxReport.Installments.Item[].DueDate']],
    ['home owner exemption', ['TaxReport.HomeOwnerExemption', 'TaxReport.HomeownersExemption', 'TaxReport.AdditionalHomesteadExemption']],
    ['special assessments', ['TaxReport.SpecialAssessments', 'TaxReport.CountSpecialAssessments']],
    ['bonds', ['TaxReport.Bonds']],
    ['supplementals', ['TaxReport.Supplementals']],
    ['as-of date', ['TaxReport.RunDate', 'TaxReport.IssueDate']],
  ];
  for (const [label, names] of NEEDS) {
    const lines = names.map((name) => {
      const l = leaves.get(name);
      if (!l) return `${name}: key absent`;
      return `${name}: ${l.filled} filled / ${l.present} present`;
    });
    const best = names.map((nm) => leaves.get(nm)?.filled ?? 0).reduce((a, b) => Math.max(a, b), 0);
    console.log(`  ${best > 0 ? '✓' : '✗'} ${label}`);
    for (const line of lines) console.log(`      ${line}`);
  }

  // One whole payload, so the nesting is legible and not inferred from paths.
  const first = (withResult[0]!.metadata as Record<string, unknown>).resultData;
  console.log(`\n=== one full payload (title_point_data #${withResult[0]!.id}) ===`);
  console.log(JSON.stringify(first, null, 2).slice(0, 6000));
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
