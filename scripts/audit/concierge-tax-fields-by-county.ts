/**
 * Is "bonds never populate" a fact about TitlePoint, or about Los Angeles?
 *
 * FREE. Reads title_point_data with jsonb extraction in SQL, so the enormous
 * blocks (PropertyImages, UnderlyingLegalInfos) never cross the wire. No vendor
 * call, no TitlePoint charge.
 *
 * WHY THIS EXISTS. concierge-tax-report-shape.ts read the 60 most recent tax
 * payloads and found Bonds empty on 58 of 58 and Supplementals present on 5.
 * Unanimity across a sample is the tell that the sample, not the field, is the
 * finding — and our order book is 639 Los Angeles against 363 Riverside and San
 * Bernardino, which are where improvement bonds and Mello-Roos districts
 * actually live. A conclusion drawn from the most recent 60 rows is a conclusion
 * about whatever was ordered last month.
 *
 * So: every stored tax payload, broken down by county.
 *
 *   npx tsx --env-file=.env.local scripts/audit/concierge-tax-fields-by-county.ts
 */
import { sql } from 'drizzle-orm';
import { db } from '../../src/lib/db/client';

/** 06037 -> "Los Angeles". Built here; fips.ts only maps the other direction. */
const FIPS_TO_COUNTY: Record<string, string> = {
  '001': 'Alameda', '003': 'Alpine', '005': 'Amador', '007': 'Butte', '009': 'Calaveras',
  '011': 'Colusa', '013': 'Contra Costa', '015': 'Del Norte', '017': 'El Dorado', '019': 'Fresno',
  '021': 'Glenn', '023': 'Humboldt', '025': 'Imperial', '027': 'Inyo', '029': 'Kern',
  '031': 'Kings', '033': 'Lake', '035': 'Lassen', '037': 'Los Angeles', '039': 'Madera',
  '041': 'Marin', '043': 'Mariposa', '045': 'Mendocino', '047': 'Merced', '049': 'Modoc',
  '051': 'Mono', '053': 'Monterey', '055': 'Napa', '057': 'Nevada', '059': 'Orange',
  '061': 'Placer', '063': 'Plumas', '065': 'Riverside', '067': 'Sacramento', '069': 'San Benito',
  '071': 'San Bernardino', '073': 'San Diego', '075': 'San Francisco', '077': 'San Joaquin',
  '079': 'San Luis Obispo', '081': 'San Mateo', '083': 'Santa Barbara', '085': 'Santa Clara',
  '087': 'Santa Cruz', '089': 'Shasta', '091': 'Sierra', '093': 'Siskiyou', '095': 'Solano',
  '097': 'Sonoma', '099': 'Stanislaus', '101': 'Sutter', '103': 'Tehama', '105': 'Trinity',
  '107': 'Tulare', '109': 'Tuolumne', '111': 'Ventura', '113': 'Yolo', '115': 'Yuba',
};

/** "CA037", "06037", "6037" and "037" all mean the same county. */
function countyOf(...codes: (string | null)[]): string {
  for (const raw of codes) {
    const s = String(raw ?? '').trim().toUpperCase();
    if (s === '') continue;
    const m = /(\d{3})$/.exec(s.replace(/^CA/, '').replace(/^0?6/, ''));
    const three = m?.[1] ?? /(\d{3})$/.exec(s)?.[1];
    if (three && FIPS_TO_COUNTY[three]) return FIPS_TO_COUNTY[three];
  }
  return '(unknown)';
}

interface Row {
  id: number;
  fips: string | null;
  legal_county: string | null;
  tax_year: string | null;
  bonds_type: string | null;
  bonds_text: string | null;
  supp_type: string | null;
  liens_type: string | null;
  lien_items: number | null;
  special_text: string | null;
  count_special: string | null;
  mello: number | null;
}

async function main() {
  // jsonb_typeof distinguishes the empty string "" from an object or array,
  // which is the distinction the whole question turns on.
  const rows = await db.execute(sql`
    with t as (
      select
        id,
        fips,
        metadata->'resultData'->'TaxReport' as tr
      from title_point_data
      where search_type = 'tax'
        and metadata ? 'resultData'
        and jsonb_typeof(metadata->'resultData'->'TaxReport') = 'object'
    )
    select
      id,
      fips,
      tr->'LegalInfos'->'Item'->'LegalNVC'->'NameValue' as legal_nv,
      tr->>'TaxYear'                       as tax_year,
      jsonb_typeof(tr->'Bonds')            as bonds_type,
      tr->>'Bonds'                         as bonds_text,
      jsonb_typeof(tr->'Supplementals')    as supp_type,
      jsonb_typeof(tr->'Liens')            as liens_type,
      case
        when jsonb_typeof(tr->'Liens'->'Item') = 'array' then jsonb_array_length(tr->'Liens'->'Item')
        when jsonb_typeof(tr->'Liens'->'Item') = 'object' then 1
        else 0
      end                                  as lien_items,
      tr->>'SpecialAssessments'            as special_text,
      tr->>'CountSpecialAssessments'       as count_special,
      case
        when tr->'Liens'->>'Item' ilike '%"IsMelloRoos":"true"%' then 1
        when tr->'Liens'->>'Item' ilike '%"IsMelloRoos": "true"%' then 1
        else 0
      end                                  as mello
    from t
    order by id desc
  `) as unknown as Array<Row & { legal_nv: unknown }>;

  console.log(`stored tax payloads with a TaxReport object: ${rows.length}`);

  const byCounty = new Map<string, {
    n: number; bondsStruct: number; bondsFilled: number;
    suppStruct: number; liensStruct: number; lienItems: number;
    specialFilled: number; countSpecialNonZero: number; mello: number;
  }>();

  for (const r of rows) {
    // The FIPS on the row, else TitlePoint's own county code in the legal block.
    let legalCode: string | null = null;
    const nv = r.legal_nv;
    if (Array.isArray(nv)) {
      for (const pair of nv) {
        const p = pair as Record<string, unknown>;
        if (String(p.Key ?? '') === 'General.FIPSCode') { legalCode = String(p.Value ?? ''); break; }
      }
    }
    const county = countyOf(r.fips, legalCode);
    const c = byCounty.get(county) ?? {
      n: 0, bondsStruct: 0, bondsFilled: 0, suppStruct: 0, liensStruct: 0,
      lienItems: 0, specialFilled: 0, countSpecialNonZero: 0, mello: 0,
    };
    c.n += 1;
    if (r.bonds_type === 'object' || r.bonds_type === 'array') c.bondsStruct += 1;
    if ((r.bonds_text ?? '').trim() !== '') c.bondsFilled += 1;
    if (r.supp_type === 'object' || r.supp_type === 'array') c.suppStruct += 1;
    if (r.liens_type === 'object' || r.liens_type === 'array') c.liensStruct += 1;
    c.lienItems += Number(r.lien_items ?? 0);
    if ((r.special_text ?? '').trim() !== '') c.specialFilled += 1;
    if (Number(r.count_special ?? 0) > 0) c.countSpecialNonZero += 1;
    c.mello += Number(r.mello ?? 0);
    byCounty.set(county, c);
  }

  console.log('\ncounty                 n   Bonds{}  Supp{}  Liens{}  lienItems  Special""  Count>0  Mello');
  console.log('─'.repeat(96));
  const sorted = [...byCounty.entries()].sort((a, b) => b[1].n - a[1].n);
  for (const [county, c] of sorted) {
    console.log(
      `${county.padEnd(22)}${String(c.n).padStart(4)}`
      + `${String(c.bondsStruct).padStart(9)}`
      + `${String(c.suppStruct).padStart(8)}`
      + `${String(c.liensStruct).padStart(9)}`
      + `${String(c.lienItems).padStart(11)}`
      + `${String(c.specialFilled).padStart(11)}`
      + `${String(c.countSpecialNonZero).padStart(9)}`
      + `${String(c.mello).padStart(7)}`,
    );
  }

  const tot = sorted.reduce((a, [, c]) => ({
    n: a.n + c.n, bondsStruct: a.bondsStruct + c.bondsStruct, suppStruct: a.suppStruct + c.suppStruct,
    liensStruct: a.liensStruct + c.liensStruct, mello: a.mello + c.mello,
    countSpecialNonZero: a.countSpecialNonZero + c.countSpecialNonZero,
    specialFilled: a.specialFilled + c.specialFilled,
  }), { n: 0, bondsStruct: 0, suppStruct: 0, liensStruct: 0, mello: 0, countSpecialNonZero: 0, specialFilled: 0 });

  console.log('─'.repeat(96));
  console.log(`\n=== the answer ===`);
  console.log(`  payloads:                        ${tot.n}`);
  console.log(`  Bonds as a structure:            ${tot.bondsStruct}  (${pct(tot.bondsStruct, tot.n)})`);
  console.log(`  Supplementals as a structure:    ${tot.suppStruct}  (${pct(tot.suppStruct, tot.n)})`);
  console.log(`  Liens as a structure:            ${tot.liensStruct}  (${pct(tot.liensStruct, tot.n)})`);
  console.log(`  SpecialAssessments non-empty:    ${tot.specialFilled}  (${pct(tot.specialFilled, tot.n)})`);
  console.log(`  CountSpecialAssessments > 0:     ${tot.countSpecialNonZero}  (${pct(tot.countSpecialNonZero, tot.n)})`);
  console.log(`  payloads with a Mello-Roos lien: ${tot.mello}  (${pct(tot.mello, tot.n)})`);
  console.log(`  counties represented:            ${sorted.length}`);

  // The control on the whole exercise: if one county is most of the sample, the
  // unanimity was about the county.
  const top = sorted[0];
  if (top) console.log(`  largest county:                  ${top[0]} at ${pct(top[1].n, tot.n)} of the sample`);
  process.exit(0);
}

const pct = (a: number, b: number) => (b === 0 ? 'n/a' : `${((a / b) * 100).toFixed(1)}%`);

main().catch((e) => { console.error(e); process.exit(1); });
