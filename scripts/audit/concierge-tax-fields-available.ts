/**
 * READ-ONLY. Does SiteX feed 100001 already carry the page-4 tax fields?
 *
 * This is open item 1 of the v6 handoff, and the whole of page 4 hangs on it:
 *
 *   yes  -> extend normalizeTax; every existing profile picks page 4 up for
 *           free through POST /profiles/[id]/render, no migration, no charge.
 *   no   -> a second SiteX product per profile. That is a second paid call,
 *           the gate copy and usage count change, and it is Gerard's call.
 *
 * NO SITEX CALL IS MADE. Nothing here is billable. The stored raw payloads
 * already contain everything feed 100001 returned — that is what
 * raw_storage_key is for and what render.ts re-derives tax from — so the
 * question is answerable by reading what we were already sold.
 *
 * Committed per EVIDENCE_RULES.md rule 6: this number decides whether we spend
 * per profile, so the method has to be one somebody else can rerun.
 */
import postgres from 'postgres';
import { downloadFile } from '../../src/lib/integrations/s3/client';

const sql = postgres(process.env.DATABASE_URL!, { max: 2, prepare: false });

/**
 * The six things page 4 is specified to show, each as the question "is there a
 * field anywhere in the payload that could supply this, and is it populated?"
 *
 * NOT a keyword list. The first version of this was, and it matched
 * PublicSchoolsReport.SchoolDistrict on "district" and ComparableSales on
 * "assessment" — 22 "populated page-4 candidates" of which none were tax
 * installments. A detector that matches things it is not about reports green
 * while measuring nothing, which is the failure EVIDENCE_RULES rule 4 is
 * written over. Each row below names what it is looking for and is asserted
 * against the fields actually found.
 */
const PAGE_4_NEEDS: { label: string; match: (path: string) => boolean }[] = [
  { label: 'annual tax amount', match: (p) => /TaxAmount|TotalAmount|TotalTax/i.test(p) },
  { label: 'two installments', match: (p) => /Installment/i.test(p) },
  { label: 'assessed split (land/improvement)', match: (p) => /(Land|Improvement)(Value|Valuation)/i.test(p) },
  { label: "homeowner's exemption", match: (p) => /HomeOwnerExemption/i.test(p) },
  { label: 'special assessments', match: (p) => /SpecialAssessment|MelloRoos/i.test(p) },
  { label: 'bonds', match: (p) => /\bBonds?\b/i.test(p) },
  { label: 'supplemental bills', match: (p) => /Supplemental/i.test(p) },
];

/**
 * Fields that exist in the payload and must never render. Listed so the script
 * reports them as a hazard rather than as an opportunity — a "new field
 * available" count that includes these is worse than no count.
 * Source: docs/titlepoint/TITLEPOINT_TAX_REPORT_ELEMENTS.md, "Excluded".
 */
const MUST_NEVER_PRINT = /Delinquen|TaxDefault|BackTax|SoldToState|Redemption|Senior|Disabled|Widow|Homestead|Litigation|Lien|RelatedOpenOrders/i;

/** The seven we already normalise, so they can be discounted from the search. */
const ALREADY_HAVE = new Set([
  'TaxYear', 'AssessedValue', 'LandValue', 'ImprovementValue',
  'MarketValue', 'TaxAmount', 'TaxStatus',
]);

const line = (s = '─') => console.log(s.repeat(78));

/** Every key path in the payload, so nothing is missed by looking in one place. */
function keyPaths(node: unknown, prefix = '', out: Map<string, unknown> = new Map()): Map<string, unknown> {
  if (node === null || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    // Index 0 is enough to learn the shape; recording every index would bury it.
    if (node.length > 0) keyPaths(node[0], `${prefix}[]`, out);
    return out;
  }
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object') keyPaths(v, path, out);
    else out.set(path, v);
  }
  return out;
}

(async () => {
  const profiles = await sql`
    SELECT id, raw_storage_key, raw_bytes, sitex_feed_id, requested_address, created_at
    FROM concierge_profiles
    WHERE raw_storage_key IS NOT NULL
    ORDER BY created_at DESC`;

  console.log(`\nProfiles with a stored raw payload: ${profiles.length}`);
  if (profiles.length === 0) {
    console.log('None. Nothing can be answered without re-pulling, which is billable.');
    await sql.end();
    return;
  }
  const feeds = [...new Set(profiles.map((p) => p.sitex_feed_id))];
  console.log(`Feed ids present: ${feeds.join(', ')}`);

  // Read every stored payload rather than one. A field that is absent because
  // THIS parcel has no bonds looks identical to a field the feed never returns,
  // and only several payloads can tell those apart.
  const seenPaths = new Map<string, { profiles: number; sample: unknown }>();
  let read = 0;

  for (const p of profiles) {
    const got = await downloadFile(p.raw_storage_key as string);
    if (!got.success) {
      console.log(`  profile ${p.id}: payload unreadable (${'error' in got ? got.error : 'unknown'})`);
      continue;
    }
    read += 1;
    let parsed: unknown;
    try {
      parsed = JSON.parse(got.data.toString('utf8'));
    } catch {
      console.log(`  profile ${p.id}: stored payload is not JSON`);
      continue;
    }
    for (const [path, value] of keyPaths(parsed)) {
      const prior = seenPaths.get(path);
      if (prior) prior.profiles += 1;
      else seenPaths.set(path, { profiles: 1, sample: value });
    }
  }

  console.log(`Payloads read: ${read} of ${profiles.length}\n`);
  if (read === 0) {
    console.log('Nothing readable. This answers nothing — do not treat it as a "no".');
    await sql.end();
    return;
  }

  // ── What is in AssessmentTaxInfo beyond the seven we take ────────────────
  line('═');
  console.log('\nAssessmentTaxInfo — EVERY key present, not just the ones we read\n');
  const taxKeys = [...seenPaths.entries()]
    .filter(([path]) => path.includes('AssessmentTaxInfo'))
    .sort();
  if (taxKeys.length === 0) {
    console.log('  No AssessmentTaxInfo section in any stored payload.');
  }
  for (const [path, info] of taxKeys) {
    const leaf = path.split('.').pop() ?? path;
    const mark = ALREADY_HAVE.has(leaf) ? '  (already normalised)' : '  <- NOT NORMALISED';
    const val = info.sample === '' ? '(empty string)' : String(info.sample).slice(0, 28);
    console.log(`  ${path.padEnd(52)} ${String(val).padEnd(30)} ${info.profiles}/${read}${mark}`);
  }

  // ── Page 4, need by need ─────────────────────────────────────────────────
  line('═');
  console.log('\nPAGE 4, NEED BY NEED — can this payload supply it?\n');

  const populated = (v: unknown) => v !== '' && v !== null && v !== undefined
    && !(typeof v === 'number' && v === 0) && String(v).toLowerCase() !== 'n/a';

  let satisfied = 0;
  for (const need of PAGE_4_NEEDS) {
    const hits = [...seenPaths.entries()]
      .filter(([path]) => need.match(path))
      // Comps and school districts are not the subject's tax record. A field
      // that satisfies a need has to be ON the subject.
      .filter(([path]) => !/ComparableSales|PublicSchoolsReport/i.test(path));
    const live = hits.filter(([, i]) => populated(i.sample));
    if (live.length > 0) satisfied += 1;
    const verdict = live.length > 0 ? 'YES' : hits.length > 0 ? 'PRESENT BUT EMPTY' : 'ABSENT';
    console.log(`  ${need.label.padEnd(36)} ${verdict}`);
    for (const [path, i] of hits.slice(0, 3)) {
      console.log(`      ${path.replace('Feed.PropertyProfile.', '')}  = ${i.sample === null ? 'null' : String(i.sample).slice(0, 24)}`);
    }
  }

  // ── Hazards: fields that exist and must never render ─────────────────────
  line('═');
  console.log('\nPRESENT AND MUST NEVER PRINT\n');
  const hazards = [...seenPaths.entries()].filter(([path]) => MUST_NEVER_PRINT.test(path));
  for (const [path, i] of hazards) {
    console.log(`  ${path.replace('Feed.PropertyProfile.', '').padEnd(46)} = ${String(i.sample).slice(0, 20)}`);
  }
  if (hazards.length === 0) console.log('  None in this payload.');

  // ── The verdict ──────────────────────────────────────────────────────────
  line('═');
  console.log('\nVERDICT\n');
  console.log(`  Payloads examined: ${read}. THIS IS THE WHOLE POPULATION, and it is small —`);
  console.log('  a field absent from three Southern California parcels could still be');
  console.log('  returned elsewhere. Treat an ABSENT above as "not seen", not "never sent".');
  console.log(`\n  Page-4 needs satisfied: ${satisfied} of ${PAGE_4_NEEDS.length}\n`);
  if (satisfied < PAGE_4_NEEDS.length) {
    console.log('  Feed 100001 CANNOT supply page 4 as specified. The missing items are');
    console.log('  the ones the page is mostly made of — installments, exemption amount,');
    console.log('  special assessments, bonds, supplementals.');
    console.log('\n  That makes page 4 a SPEND DECISION, not a rendering one.');
  } else {
    console.log('  Feed 100001 can supply page 4. Extend normalizeTax; existing profiles');
    console.log('  pick it up for free via POST /render.');
  }

  line('═');
  await sql.end();
})().catch((e) => { console.error('FAILED:', String(e).slice(0, 500)); process.exit(1); });
