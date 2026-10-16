/**
 * SPENDS EXACTLY TWO SiteX CREDITS. Approved by Gerard, 16 Oct 2026:
 * "Verify on Paseo La Cresta and on a single-match address, one credit each,
 * and show the vendor log lines that prove it."
 *
 * ─── WHAT IT DRIVES, AND WHY THAT IS THE POINT ──────────────────────────────
 *
 * It calls resolveProperty() — the real function the deployed route calls, not
 * an approximation of it. That became possible only with this change: while
 * the spend shared a module with the render, importing it pulled in
 * @react-pdf/textkit, whose import of `@react-pdf/hyphenate/en-us` is not in
 * that package's `exports`, so the module died at import under tsx. The
 * previous verification could therefore only exercise the feed client and had
 * to say out loud that the archive path was unproven.
 *
 * So this exercises the claim, the already-have check, the resolution reuse,
 * the guard, the archive to S3 and the row — everything up to the document.
 *
 * ─── WHAT IT STILL DOES NOT PROVE ───────────────────────────────────────────
 *
 * The render, and the two dialogs as an operator meets them. finaliseProfile
 * is free, so that half costs a click rather than money — and this says so
 * rather than glossing it.
 *
 * ─── FOUR RUNS, TWO OF THEM FREE ────────────────────────────────────────────
 *
 *   A  Paseo La Cresta BY ADDRESS   expect 300, candidates, ZERO credits
 *   B  the picked parcel BY APN     expect one credit, a resolution
 *   C  the same parcel again        expect ZERO credits, the SAME row
 *   D  1358 5th St, single match    expect one credit
 *
 * B and D are the two credits. A is the multi-match that used to charge before
 * the operator had even seen the list; C is the second operator in the window.
 *
 * ─── IT WRITES ──────────────────────────────────────────────────────────────
 *
 * Profile rows and archived payloads, which is what resolving a property IS.
 * It repairs nothing and touches no existing row.
 *
 *   npx tsx --env-file=.env.local scripts/audit/verify-resolve-first.mts --spend
 */
import { sql } from 'drizzle-orm';
import { db } from '../../src/lib/db/client';
import { resolveProperty } from '../../src/lib/domain/concierge/resolve';

const PASEO = {
  street: '25651 Paseo La Cresta', city: 'Laguna Niguel', state: 'CA', zip: '92677',
};
/** The unit a rep picked out of the 300 on 2026-10-16. Owner LIPSITZ. */
const PICKED = { apn: '930-371-05', fips: '06059' };
/**
 * PCT's own test property, and the one profile 3 was generated from.
 *
 * `allowDuplicate` because we already hold generated profiles for it, so
 * without the flag the already-have check correctly refuses and the run would
 * prove nothing about the spend. That is the flag doing its job, not being
 * worked around: it is exactly "I know we have one, look it up again."
 */
const SINGLE = {
  street: '1358 5th St', city: 'La Verne', state: 'CA', zip: '91750', allowDuplicate: true,
};

const money = (n: number) => (n === 0 ? 'FREE' : `${n} CREDIT${n === 1 ? '' : 'S'}`);

function report(label: string, r: Awaited<ReturnType<typeof resolveProperty>>) {
  console.log(`\n─── ${label} ${'─'.repeat(Math.max(0, 66 - label.length))}`);
  if (r.ok) {
    const p = r.resolved;
    console.log(`  outcome       : resolved`);
    console.log(`  charged       : ${money(p.creditsCharged)}${p.reused ? '   (reused a resolution already paid for)' : ''}`);
    console.log(`  profile row   : ${p.profileId}`);
    console.log(`  searchId      : ${p.searchId ?? '-'}`);
    console.log(`  apn           : ${p.apn ?? '-'}`);
    console.log(`  owner         : ${p.primaryOwner ?? '-'}`);
    console.log(`  site address  : ${[p.siteAddress, p.siteCityState].filter(Boolean).join(', ') || '-'}`);
    console.log(`  use           : ${p.useDescription ?? '-'}`);
    return p;
  }
  console.log(`  outcome       : refused`);
  console.log(`  charged       : ${money(r.creditsCharged)}`);
  console.log(`  profile row   : ${r.profileId ?? '-'}`);
  console.log(`  message       : ${r.message}`);
  if ('candidates' in r && r.candidates) {
    console.log(`  candidates    : ${r.candidates.length}`);
    for (const c of r.candidates) {
      const unit = [c.unitType, c.unitNumber].filter(Boolean).join('');
      console.log(`     - APN ${c.apn}  fips ${c.fips ?? '-'}  ${unit ? `unit ${unit}  ` : ''}${c.owner ?? ''}`);
    }
  }
  if ('alreadyHave' in r) console.log(`  already have  : profile ${r.alreadyHave.id}, ${r.alreadyHave.ageDays} days old`);
  return null;
}

/** The row as it actually sits in the database, which is the thing that bills. */
async function showRow(id: number) {
  const r = await db.execute(sql`
    select status, sitex_credits_charged, sitex_search_id, raw_storage_key, raw_bytes,
           prepared_for_name, presenting_rep_name, subject_apn, pdf_storage_key,
           requested_apn, requested_fips, location_count, is_valid_address
      from concierge_profiles where id = ${id}`);
  const row = ((r as unknown as { rows?: Record<string, unknown>[] }).rows ?? (r as unknown as Record<string, unknown>[]))[0];
  if (!row) { console.log(`  (no row ${id})`); return; }
  console.log(`  ── row ${id} as stored ──`);
  console.log(`     status            : ${row.status}`);
  console.log(`     credits charged   : ${row.sitex_credits_charged}`);
  console.log(`     searchId          : ${row.sitex_search_id ?? '-'}`);
  console.log(`     payload archived  : ${row.raw_storage_key ?? 'NONE'} (${row.raw_bytes ?? 0} bytes)`);
  console.log(`     subject apn       : ${row.subject_apn ?? '-'}`);
  console.log(`     searched by apn   : ${row.requested_apn ?? '-'} / fips ${row.requested_fips ?? '-'}`);
  console.log(`     locationCount     : ${row.location_count ?? '-'}   isValidAddress ${row.is_valid_address ?? '-'}`);
  // THE DESIGN, READ BACK OFF THE ROW. A resolution has no gate and no
  // document; if either of these is filled in, the gate has crept back in
  // front of the lookup.
  console.log(`     preparedForName   : ${row.prepared_for_name ?? 'NULL  <- correct: nobody has typed one'}`);
  console.log(`     presentingRepName : ${row.presenting_rep_name ?? 'NULL  <- correct: chosen at the gate'}`);
  console.log(`     document          : ${row.pdf_storage_key ?? 'NONE  <- correct: resolve renders nothing'}`);
}

(async () => {
  if (!process.argv.includes('--spend')) {
    console.log('\nThis SPENDS TWO SiteX CREDITS. Re-run with --spend to confirm.\n');
    console.log(`  B  ${PICKED.apn} (fips ${PICKED.fips})  — 25651 Paseo La Cresta, unit #45`);
    console.log(`  D  ${SINGLE.street}, ${SINGLE.city} ${SINGLE.zip}  — single match, allowDuplicate`);
    console.log('\n  A (the multi-match) and C (the reuse) are free.\n');
    process.exit(0);
  }

  const started = new Date();

  // ─── A. The multi-match. FREE, and this is the whole saving. ──────────────
  const a = await resolveProperty(PASEO);
  report('A  25651 Paseo La Cresta, BY ADDRESS', a);
  if (a.ok) {
    console.log('\n  !! Expected a multi-match here. It resolved instead, which is');
    console.log('     not a failure — but A was meant to be the free question.');
  } else if (a.creditsCharged !== 0) {
    console.log(`\n  !! A CHARGED ${a.creditsCharged}. A multi-match must be free.`);
  }

  // ─── B. The pick. ONE CREDIT. ────────────────────────────────────────────
  const b = await resolveProperty({ ...PASEO, ...PICKED });
  const bp = report('B  the picked parcel, BY APN  (THE SPEND)', b);
  if (bp) await showRow(bp.profileId);

  // ─── C. The second operator. FREE. ───────────────────────────────────────
  const c = await resolveProperty({ ...PASEO, ...PICKED });
  const cp = report('C  the same parcel again  (the second operator)', c);
  if (cp && bp) {
    const same = cp.profileId === bp.profileId;
    console.log(`\n  same row as B          : ${same}`);
    console.log(`  charged for the second : ${money(cp.creditsCharged)}`);
    if (!same || cp.creditsCharged !== 0) {
      console.log('  !! TWO OPERATORS DID NOT SHARE ONE CREDIT. This is the');
      console.log('     behaviour the resolution reuse exists for.');
    }
  }

  // ─── D. A single match. ONE CREDIT. ──────────────────────────────────────
  const d = await resolveProperty(SINGLE);
  const dp = report('D  1358 5th St, single match  (THE SECOND SPEND)', d);
  if (dp) await showRow(dp.profileId);

  // ─── The vendor log lines ────────────────────────────────────────────────
  //
  // Asked of the database rather than printed from memory: what the log says
  // is what reconciles against an invoice, and the point of this run is that
  // the two match.
  console.log(`\n─── vendor_api_logs, SiteX, since this run began ${'─'.repeat(20)}`);
  const logs = await db.execute(sql`
    select id, operation, success, http_status,
           response_meta->>'creditsCharged' as credits,
           response_meta->>'searchId'       as search_id,
           response_meta->>'locationCount'  as locations,
           response_meta->>'matchCode'      as match_code,
           request_meta->>'addr'            as addr,
           request_meta->>'apn'             as apn,
           extract(epoch from (ended_at - started_at)) * 1000 as ms
      from vendor_api_logs
     where vendor = 'sitex' and started_at >= ${started.toISOString()}
     order by id`);
  const rows = ((logs as unknown as { rows?: Record<string, unknown>[] }).rows
    ?? (logs as unknown as Record<string, unknown>[]));
  if (rows.length === 0) {
    console.log('  NO LOG LINES. The calls happened, so this is a logging gap and');
    console.log('  it is the thing that makes a charge unreconcilable.');
  }
  let billed = 0;
  for (const r of rows) {
    const credits = Number(r.credits ?? 0);
    billed += credits;
    console.log(`  #${r.id}  ${String(r.operation).padEnd(18)} http ${r.http_status}  ${money(credits).padEnd(8)}`
      + `  searchId ${String(r.search_id ?? '-').padEnd(11)} locations ${String(r.locations ?? '-').padEnd(4)}`
      + `  ${Math.round(Number(r.ms ?? 0))}ms`);
    console.log(`        ${r.apn ? `apn ${r.apn}` : `addr ${r.addr ?? '-'}`}`);
  }

  console.log(`\n─── VERDICT ${'─'.repeat(58)}`);
  console.log(`  credits the vendor log accounts for : ${billed}`);
  console.log(`  approved for this run               : 2`);
  console.log(`  ${billed === 2 ? 'MATCHES.' : 'DOES NOT MATCH — say so, do not round it off.'}`);
  console.log('\n  NOT PROVEN HERE, and needs one click each on the deployed route:');
  console.log('    - finaliseProfile and the document render (free)');
  console.log('    - the lookup confirmation and the gate as an operator meets them');
  console.log('');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
