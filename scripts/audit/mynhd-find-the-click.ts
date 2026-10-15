/**
 * READ ONLY. Gerard clicked "Add hazard preview" on production and nothing
 * happened. Where did the request get to?
 *
 * Since #220 an account-level refusal writes NOTHING to the profile row, so
 * "no row change" is expected and proves little on its own. What distinguishes
 * the cases is the vendor log: the bridge logs every MyNHD attempt through
 * mynhd_preview, including refusals.
 *
 *   a log row          -> the bridge ran and MyNHD answered. Read the category.
 *   no log, no row     -> the request never reached fetchFloodFirePreview.
 *                         Either the route refused early, or the click never
 *                         left the browser.
 *
 *   npx tsx --env-file=.env.local scripts/audit/mynhd-find-the-click.ts [hours]
 */
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';

const hours = Number.isFinite(Number(process.argv[2])) && Number(process.argv[2]) > 0
  ? Number(process.argv[2]) : 12;

async function main() {
  console.log(`\nnow: ${new Date().toISOString()}   window: last ${hours}h\n`);

  // 1. Every MyNHD call ever logged, not just the window — there should be
  //    very few, and "none at all" is itself the finding.
  const ever = await db.execute(sql`
    select count(*)::int as n, min(created_at) as first, max(created_at) as last
      from vendor_api_logs where vendor = 'mynhd'`);
  const e = ((ever as unknown as { rows?: Record<string, unknown>[] }).rows
    ?? (ever as unknown as Record<string, unknown>[]))[0];
  console.log('=== mynhd rows in vendor_api_logs, all time ===');
  console.log(`  ${String(e?.n)} row(s)` + (Number(e?.n) > 0 ? `  ${String(e?.first)} -> ${String(e?.last)}` : ''));

  if (Number(e?.n) > 0) {
    const rows = await db.execute(sql`
      select to_char(created_at, 'MM-DD HH24:MI:SS') as at, operation, success,
             error_category, request_meta, response_meta
        from vendor_api_logs where vendor = 'mynhd'
       order by created_at desc limit 20`);
    for (const x of ((rows as unknown as { rows?: Record<string, unknown>[] }).rows
      ?? (rows as unknown as Record<string, unknown>[]))) {
      console.log(`\n  ${String(x.at)}  ${x.success ? 'ok' : 'FAIL'}  ${String(x.operation)}  ${String(x.error_category ?? '')}`);
      console.log(`    request : ${JSON.stringify(x.request_meta)}`);
      console.log(`    response: ${JSON.stringify(x.response_meta)}`);
    }
  }

  // 2. Any profile that carries hazard state at all.
  const prof = await db.execute(sql`
    select id, to_char(created_at, 'MM-DD HH24:MI') as created,
           requested_address, subject_apn, subject_fips,
           hazard_requested, hazard_status, hazard_error,
           hazard_storage_key, hazard_width, hazard_height,
           to_char(hazard_requested_at, 'MM-DD HH24:MI:SS') as hazard_at
      from concierge_profiles
     where hazard_requested or hazard_status is not null
        or hazard_error is not null or hazard_storage_key is not null
     order by id desc`);
  const prows = (prof as unknown as { rows?: Record<string, unknown>[] }).rows
    ?? (prof as unknown as Record<string, unknown>[]);

  console.log(`\n=== profiles carrying ANY hazard state: ${prows.length} ===`);
  if (prows.length === 0) {
    console.log('  none. Expected since #220 if the refusal was account-level —');
    console.log('  it restores the row — so this neither confirms nor denies a click.');
  }
  for (const p of prows) {
    console.log(`  profile ${String(p.id)}  ${String(p.requested_address)}`);
    console.log(`    requested=${String(p.hazard_requested)} status=${String(p.hazard_status)} at=${String(p.hazard_at)}`);
    console.log(`    error=${JSON.stringify(p.hazard_error)}`);
    console.log(`    png=${String(p.hazard_storage_key)} ${String(p.hazard_width)}x${String(p.hazard_height)}`);
  }

  // 3. Which profiles could even be asked. The bridge refuses before the
  //    vendor when there is no payload or no parcel, and that refusal is not
  //    logged anywhere — so a click on one of those looks identical to a click
  //    that never happened.
  const askable = await db.execute(sql`
    select count(*)::int                                                      as total,
           count(*) filter (where raw_storage_key is null)                    as no_payload,
           count(*) filter (where coalesce(subject_apn,'') = ''
                               or coalesce(subject_fips,'') = '')             as no_parcel
      from concierge_profiles`);
  const a = ((askable as unknown as { rows?: Record<string, unknown>[] }).rows
    ?? (askable as unknown as Record<string, unknown>[]))[0];
  console.log('\n=== could a click even reach MyNHD? ===');
  console.log(`  profiles                     : ${String(a?.total)}`);
  console.log(`  no stored payload (refused)  : ${String(a?.no_payload)}`);
  console.log(`  no APN or no FIPS (refused)  : ${String(a?.no_parcel)}`);
  console.log('  Those refusals happen before the vendor and write nothing and log nothing.');
  console.log('');
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
