/**
 * Does page 4's annual tax figure ALREADY INCLUDE the Mello-Roos line, or sit
 * alongside it?
 *
 * FREE. Reads title_point_data. No vendor call, no TitlePoint charge.
 *
 * WHY IT MATTERS (Jerry, 2026-10-01). The disclosure draft says a special tax
 * "is levied in addition to the base property tax". If TitlePoint's TotalTax —
 * which is what page 4 prints as the annual amount — already contains that
 * special tax, then a reader who adds it on top believes their bill is higher
 * than it is. If it does not, the word "addition" is correct and the two
 * figures are meant to be summed. This is arithmetic, not a judgement.
 *
 * THE TEST. For every payload carrying a Mello-Roos lien:
 *
 *     advalorem = (land + improvements - homeOwnerExemption) x TaxRate/100
 *     liens     = sum of Liens.Item[].Amount
 *
 * and then ask which of these TotalTax matches:
 *
 *     TotalTax == advalorem            -> TotalTax EXCLUDES the assessments
 *     TotalTax == advalorem + liens    -> TotalTax INCLUDES them
 *
 * Measured over the Mello-Roos population specifically, because that is the
 * population the sentence will appear on, and over the whole book as a control
 * — a rule that holds only on the cases we looked at is not a rule.
 *
 *   npx tsx --env-file=.env.local scripts/audit/concierge-mello-roos-arithmetic.ts
 */
import { sql } from 'drizzle-orm';
import { db } from '../../src/lib/db/client';

const money = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const c = v.replace(/[$,\s]/g, '').trim();
  if (c === '') return null;
  const n = Number(c);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Item is an object when there is one and an array when there are several. */
function items(block: unknown): Record<string, unknown>[] {
  if (!block || typeof block !== 'object') return [];
  const raw = (block as Record<string, unknown>).Item;
  if (Array.isArray(raw)) return raw.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object');
  return raw && typeof raw === 'object' ? [raw as Record<string, unknown>] : [];
}

interface Verdict {
  id: number;
  total: number;
  advalorem: number;
  liens: number;
  mello: number;
  matchesAdvalorem: boolean;
  matchesAdvaloremPlusLiens: boolean;
}

function classify(tr: Record<string, unknown>, id: number): Verdict | null {
  const land = money(tr.LandValuation);
  const imp = money(tr.ImprovementsValuation);
  const rate = money(tr.TaxRate);
  const total = money(tr.TotalTax);
  const hoe = money(tr.HomeOwnerExemption) ?? 0;
  if (land === null || imp === null || rate === null || total === null) return null;

  const lienItems = items(tr.Liens);
  const liens = lienItems.reduce((a, l) => a + (money(l.Amount) ?? 0), 0);
  const mello = lienItems
    .filter((l) => String(l.IsMelloRoos ?? '').toLowerCase() === 'true')
    .reduce((a, l) => a + (money(l.Amount) ?? 0), 0);

  const advalorem = (land + imp - hoe) * (rate / 100);
  // Same tolerance the render guard uses: 0.5% with a dollar floor.
  const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, b * 0.005);

  return {
    id, total, advalorem, liens, mello,
    matchesAdvalorem: near(advalorem, total),
    matchesAdvaloremPlusLiens: near(advalorem + liens, total),
  };
}

function report(label: string, vs: Verdict[]) {
  const n = vs.length;
  if (n === 0) { console.log(`\n${label}: no payloads`); return; }
  const onlyAd = vs.filter((v) => v.matchesAdvalorem && !v.matchesAdvaloremPlusLiens).length;
  const onlyPlus = vs.filter((v) => !v.matchesAdvalorem && v.matchesAdvaloremPlusLiens).length;
  const both = vs.filter((v) => v.matchesAdvalorem && v.matchesAdvaloremPlusLiens).length;
  const neither = vs.filter((v) => !v.matchesAdvalorem && !v.matchesAdvaloremPlusLiens).length;
  const pct = (x: number) => `${((x / n) * 100).toFixed(1)}%`;

  console.log(`\n=== ${label} (${n} payloads) ===`);
  console.log(`  TotalTax == advalorem only       ${String(onlyAd).padStart(5)}  ${pct(onlyAd)}   -> EXCLUDES the assessments`);
  console.log(`  TotalTax == advalorem + liens    ${String(onlyPlus).padStart(5)}  ${pct(onlyPlus)}   -> INCLUDES them`);
  console.log(`  both (liens are ~0, ambiguous)   ${String(both).padStart(5)}  ${pct(both)}`);
  console.log(`  neither                          ${String(neither).padStart(5)}  ${pct(neither)}`);
}

async function main() {
  const rows = await db.execute(sql`
    select id,
      (metadata->'resultData'->'TaxReport')
        - 'PropertyImages' - 'PropertyImageTypes' - 'UnderlyingLegalInfos'
        - 'UnderlyingPropertyXrefs' - 'LegalInfos' - 'SearchAsPointers'
        - 'AssessedOwners' - 'MailingNames' - 'TransferOwners' - 'Image'
        - 'DocumentInformation' - 'Parcels' - 'UnderlyingParcels' as tr
    from title_point_data
    where search_type = 'tax'
      and metadata ? 'resultData'
      and jsonb_typeof(metadata->'resultData'->'TaxReport') = 'object'
    order by id desc
  `) as unknown as Array<{ id: number; tr: Record<string, unknown> }>;

  const all: Verdict[] = [];
  const withMello: Verdict[] = [];
  for (const r of rows) {
    const v = classify(r.tr, r.id);
    if (!v) continue;
    all.push(v);
    if (v.mello > 0) withMello.push(v);
  }

  console.log(`payloads with all four parts: ${all.length} of ${rows.length}`);
  report('MELLO-ROOS PARCELS — the population the sentence appears on', withMello);
  report('WHOLE BOOK — the control', all);

  console.log('\n=== worked examples from Mello-Roos parcels ===');
  for (const v of withMello.slice(0, 8)) {
    console.log(
      `  #${String(v.id).padEnd(6)} TotalTax $${v.total.toFixed(2).padStart(11)}`
      + `  advalorem $${v.advalorem.toFixed(2).padStart(11)}`
      + `  liens $${v.liens.toFixed(2).padStart(9)}`
      + `  (mello $${v.mello.toFixed(2)})`,
    );
  }

  const melloOnlyAd = withMello.filter((v) => v.matchesAdvalorem && !v.matchesAdvaloremPlusLiens).length;
  console.log('\n=== the answer ===');
  if (withMello.length === 0) {
    console.log('  No Mello-Roos payload carries all four parts. Cannot answer.');
  } else if (melloOnlyAd / withMello.length > 0.9) {
    console.log('  TotalTax EXCLUDES the direct assessments, Mello-Roos included.');
    console.log('  Page 4’s annual amount is the ad valorem tax only, so a special');
    console.log('  tax IS in addition to it and "in addition to" is correct.');
  } else {
    console.log('  NOT a clean exclusion — read the distribution above before wording anything.');
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
