/**
 * READ-ONLY. Spends nothing, writes nothing.
 *
 * Confirms, from the database, what the resolve-first flow actually did when
 * an operator ran it through the UI on production. The verification was moved
 * off a script and onto the real thing (Gerard, 16 Oct 2026): a laptop never
 * needs the concierge feed id, and the deployed function already has it.
 *
 * ─── IT READS concierge_profile, NOT property_search ────────────────────────
 *
 * Two different operations reach SiteX and they are logged separately:
 *
 *   property_search / apn_lookup   the ORDERS flow (client.ts)
 *   concierge_profile              the CONCIERGE feed (concierge-feed.ts)
 *
 * The first version of this script filtered on `property_search` and
 * `request_meta->>'addr'`, and would have reported "no multi-match recorded"
 * however well the flow had worked — the concierge feed writes neither of
 * those. A check that cannot see the thing it is checking reads exactly like a
 * pass, which is the failure mode worth more than the check.
 *
 * ─── THE THREE FACTS IT IS LOOKING FOR ──────────────────────────────────────
 *
 *   1. ONE 300 AT ZERO. The address matched more than one parcel and the
 *      question was free. Under the old flow it charged before the operator
 *      had even seen the list.
 *   2. ONE PARCEL CALL AT ONE CREDIT. The unit the operator confirmed. One
 *      credit for the whole condominium, where it used to be two.
 *   3. THE SECOND ATTEMPT MADE NO VENDOR CALL. It found the resolved row and
 *      offered to finish it free. This one is proven by the ABSENCE of a log
 *      line, so the call count is reported rather than a green tick.
 *
 *   npx tsx --env-file=.env.local scripts/audit/resolve-first-log-check.mts
 *   npx tsx --env-file=.env.local scripts/audit/resolve-first-log-check.mts --minutes 180
 */
import { sql } from 'drizzle-orm';
import { db } from '../../src/lib/db/client';

const argMinutes = (() => {
  const i = process.argv.indexOf('--minutes');
  const n = i === -1 ? NaN : Number(process.argv[i + 1]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 90;
})();

/** 25651 Paseo La Cresta, unit #45, owner LIPSITZ. */
const APN_DIGITS = '93037105';

type Row = Record<string, unknown>;
const rowsOf = (r: unknown): Row[] => ((r as { rows?: Row[] }).rows ?? (r as Row[])) ?? [];
const money = (n: number) => (n === 0 ? 'FREE' : `${n} credit${n === 1 ? '' : 's'}`);

(async () => {
  console.log(`\n═══ resolve-first, as production recorded it (last ${argMinutes} min) ═══`);

  // ─── The concierge lines: the flow under test ────────────────────────────
  const logs = rowsOf(await db.execute(sql`
    select id, started_at, success, error_category,
           response_meta->>'httpStatus'     as http_status,
           response_meta->>'creditsCharged' as credits,
           response_meta->>'searchId'       as search_id,
           response_meta->>'locationCount'  as locations,
           response_meta->>'bytes'          as bytes,
           response_meta->>'isValidAddress' as valid_addr,
           request_meta->>'searchedBy'      as searched_by,
           request_meta->>'apn'             as apn,
           request_meta->>'fips'            as fips,
           request_meta->>'lastLine'        as last_line,
           request_meta->>'feedId'          as feed_id,
           extract(epoch from (ended_at - started_at)) * 1000 as ms
      from vendor_api_logs
     where vendor = 'sitex' and operation = 'concierge_profile'
       and started_at > now() - (${argMinutes} || ' minutes')::interval
     order by id`));

  console.log(`\n── vendor_api_logs, concierge_profile: ${logs.length} line${logs.length === 1 ? '' : 's'} ──`);
  if (logs.length === 0) console.log('   (none — the flow has not been run in this window)');
  let billed = 0;
  for (const r of logs) {
    const credits = Number(r.credits ?? 0);
    billed += credits;
    const by = r.searched_by === 'parcel'
      ? `parcel apn ${r.apn} fips ${r.fips}`
      : `address · ${r.last_line ?? '-'}`;
    console.log(
      `  #${r.id}  ${String(r.started_at)}  ${r.success ? 'ok     ' : 'refused'}`
      + `  ${String(r.error_category ?? '-').padEnd(16)} http ${String(r.http_status ?? '-').padEnd(4)}`
      + ` ${money(credits).padEnd(9)} searchId ${String(r.search_id ?? '-').padEnd(11)}`
      + ` locations ${String(r.locations ?? '-').padEnd(3)} ${Math.round(Number(r.ms ?? 0))}ms`,
    );
    console.log(`         searched by ${by}   feed ${r.feed_id ?? '-'}`
      + `${r.bytes ? `   ${Number(r.bytes).toLocaleString()} bytes` : ''}`
      + `${r.valid_addr !== null && r.valid_addr !== undefined ? `   isValidAddress ${r.valid_addr}` : ''}`);
  }
  console.log(`\n  credits charged in this window: ${billed}`);

  // ─── The profile rows the flow produced ──────────────────────────────────
  const profiles = rowsOf(await db.execute(sql`
    select id, status, created_at, requested_address, requested_apn, subject_apn,
           sitex_credits_charged as credits, sitex_search_id as search_id,
           raw_bytes, prepared_for_name, presenting_rep_name,
           pdf_storage_key is not null as has_pdf,
           location_count, is_valid_address, error_message
      from concierge_profiles
     where created_at > now() - (${argMinutes} || ' minutes')::interval
     order by id`));

  console.log(`\n── concierge_profiles created: ${profiles.length} ──`);
  for (const p of profiles) {
    console.log(
      `  row ${p.id}  ${String(p.status).padEnd(10)} ${money(Number(p.credits ?? 0)).padEnd(9)}`
      + ` searchId ${String(p.search_id ?? '-').padEnd(11)} ${Number(p.raw_bytes ?? 0).toLocaleString()} bytes`
      + `  doc ${p.has_pdf ? 'YES' : 'no'}`,
    );
    console.log(`         requested ${p.requested_address ?? '-'}${p.requested_apn ? ` (apn ${p.requested_apn})` : ''}`);
    console.log(`         subject apn ${p.subject_apn ?? '-'}   locationCount ${p.location_count ?? '-'}   isValidAddress ${p.is_valid_address ?? '-'}`);
    console.log(`         preparedFor ${p.prepared_for_name ?? 'NULL'}   rep ${p.presenting_rep_name ?? 'NULL'}`);
    if (p.error_message) console.log(`         error: ${p.error_message}`);
  }

  // ─── The three facts ─────────────────────────────────────────────────────
  console.log('\n── the three facts ──');

  const byAddress = logs.filter((r) => r.searched_by === 'address');
  const byParcel = logs.filter((r) => r.searched_by === 'parcel');
  const thisParcel = byParcel.filter((r) => String(r.apn ?? '').replace(/\D/g, '') === APN_DIGITS);

  // 1. the free multi-match
  const multi = byAddress.filter((r) => r.error_category === 'ambiguous_match');
  const multiFree = multi.filter((r) => Number(r.credits ?? 0) === 0);
  console.log(`  1. multi-match at zero  : ${multi.length} found, ${multiFree.length} free`);
  for (const r of multi) {
    console.log(`       #${r.id}  http ${r.http_status}  ${r.locations} parcels offered  ${money(Number(r.credits ?? 0))}`);
  }
  if (multi.length > 0 && multiFree.length !== multi.length) {
    console.log('     !! A MULTI-MATCH CHARGED. That is the defect this flow removes.');
  }
  if (multi.length === 0) {
    console.log('     (no 300 recorded. If the picker did not appear, say that —');
    console.log('      do not read an absent line as a pass.)');
  }

  // 2. the one paid parcel call
  const paid = thisParcel.filter((r) => Number(r.credits ?? 0) > 0);
  const paidTotal = paid.reduce((a, r) => a + Number(r.credits ?? 0), 0);
  console.log(`  2. the confirmed parcel : ${thisParcel.length} call(s) on ${APN_DIGITS}, ${paid.length} charged, ${paidTotal} credit(s)`);
  for (const r of thisParcel) {
    console.log(`       #${r.id}  ${r.success ? 'ok' : `refused (${r.error_category})`}  ${money(Number(r.credits ?? 0))}  searchId ${r.search_id ?? '-'}`);
  }
  if (paidTotal > 1) console.log('     !! CHARGED MORE THAN ONCE for one parcel.');

  // 3. the absence
  console.log(`  3. second attempt       : ${logs.length} concierge call(s) in the window`);
  console.log('     Two runs of the flow are correct at TWO calls: one 300 (free) and');
  console.log('     one parcel (charged). A third means the reuse did not fire and the');
  console.log('     property was bought twice.');

  const resolvedRows = profiles.filter((p) => p.status === 'retrieved');
  const generatedRows = profiles.filter((p) => p.status === 'generated');
  console.log(`\n  rows resolved (paid, no document) : ${resolvedRows.length}`);
  console.log(`  rows generated                    : ${generatedRows.length}`);
  console.log('  A generated row with ONE credit against it, and no second charge on');
  console.log('  the same parcel, is the whole claim.');

  // ─── #227, now that it is deployed ───────────────────────────────────────
  const ps = rowsOf(await db.execute(sql`
    select id, started_at, operation,
           response_meta->>'creditsCharged' as credits,
           response_meta->>'searchId'       as search_id,
           response_meta->>'httpStatus'     as http_status
      from vendor_api_logs
     where vendor = 'sitex' and operation in ('property_search', 'apn_lookup')
       and started_at > now() - (${argMinutes} || ' minutes')::interval
     order by id`));
  const blind = ps.filter((r) => r.credits === null || r.search_id === null);
  console.log(`\n── the orders flow, same window: ${ps.length} line(s), ${blind.length} with no cost or searchId ──`);
  console.log('   #227 merged 2026-10-16 17:21 and covers property_search only.');
  console.log('   Lines before that deploy legitimately carry nulls; property_search');
  console.log('   lines after it that still do mean the fix is not taking effect.');
  console.log('   apn_lookup is a DIFFERENT operation and is a known, ticketed gap.');
  for (const r of blind) {
    console.log(`     #${r.id}  ${r.started_at}  ${r.operation}`);
  }

  console.log('');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
