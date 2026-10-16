/**
 * READ ONLY, NO VENDOR CALL. What did SiteX actually return for one address?
 *
 * A rep reports the unit picker not appearing on a condo. There are three
 * different defects that look identical from the outside — a 300 whose
 * candidates carry no UnitNumber, a 200 that resolved to one unit on its own,
 * or a 404 because Google's spelling is not SiteX's — and each needs a
 * different fix. The logged response says which.
 *
 *   npx tsx --env-file=.env.local scripts/audit/concierge-address-response.ts "paseo la cresta"
 */
import { desc, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { vendorApiLogs } from '@/lib/db/schema/integrations';
import { conciergeProfiles } from '@/lib/db/schema/concierge';

async function main() {
  const needle = (process.argv.slice(2).find((a) => !a.startsWith('-')) ?? '').trim();
  if (!needle) { console.error('usage: concierge-address-response.ts "<part of the address>"'); process.exit(1); }
  const like = `%${needle.toLowerCase()}%`;

  // ─── The profile rows ────────────────────────────────────────────────────
  const profiles = await db
    .select({
      id: conciergeProfiles.id,
      createdAt: conciergeProfiles.createdAt,
      address: conciergeProfiles.requestedAddress,
      city: conciergeProfiles.requestedCity,
      zip: conciergeProfiles.requestedZip,
      status: conciergeProfiles.status,
      error: conciergeProfiles.errorMessage,
      apn: conciergeProfiles.subjectApn,
      fips: conciergeProfiles.subjectFips,
      requestedApn: conciergeProfiles.requestedApn,
      locationCount: conciergeProfiles.locationCount,
      isValid: conciergeProfiles.isValidAddress,
      outside: conciergeProfiles.outsideCoverage,
      matchMethod: conciergeProfiles.matchMethodCode,
      candidates: conciergeProfiles.matchCandidates,
      credits: conciergeProfiles.sitexCreditsCharged,
      searchId: conciergeProfiles.sitexSearchId,
    })
    .from(conciergeProfiles)
    .where(sql`lower(${conciergeProfiles.requestedAddress}) like ${like}`)
    .orderBy(desc(conciergeProfiles.id));

  console.log(`\n=== concierge_profiles matching ${JSON.stringify(needle)}: ${profiles.length} ===`);
  for (const p of profiles) {
    console.log(`\n  profile ${p.id}  ${String(p.createdAt).slice(0, 19)}`);
    console.log(`    asked for : ${p.address}, ${p.city ?? ''} ${p.zip ?? ''}`);
    console.log(`    status    : ${p.status}   credits=${p.credits}   searchId=${p.searchId ?? '-'}`);
    console.log(`    error     : ${p.error ?? '(none)'}`);
    console.log(`    guard     : isValid=${p.isValid} outside=${p.outside} locationCount=${p.locationCount} matchMethod=${p.matchMethod}`);
    console.log(`    subject   : apn=${p.apn ?? '-'} fips=${p.fips ?? '-'}   requestedApn=${p.requestedApn ?? '-'}`);
    const c = p.candidates as unknown[] | null;
    console.log(`    candidates: ${c === null ? 'NULL — none were stored' : `${c.length} stored`}`);
    if (Array.isArray(c)) for (const one of c) console.log(`      ${JSON.stringify(one)}`);
  }

  // ─── The vendor log, which is the authority on what came back ────────────
  const logs = await db.execute(sql`
    select to_char(created_at, 'MM-DD HH24:MI:SS') as at,
           operation, success, error_category, request_meta, response_meta
      from vendor_api_logs
     where vendor = 'sitex'
       and (lower(request_meta::text) like ${like} or lower(response_meta::text) like ${like})
     order by created_at desc
     limit 10`);
  const rows = (logs as unknown as { rows?: Record<string, unknown>[] }).rows
    ?? (logs as unknown as Record<string, unknown>[]);

  console.log(`\n=== sitex vendor_api_logs mentioning it: ${rows.length} ===`);
  for (const r of rows) {
    console.log(`\n  ${String(r.at)}  ${r.success ? 'ok' : 'FAIL'}  ${String(r.operation)}  ${String(r.error_category ?? '')}`);
    console.log(`    request : ${JSON.stringify(r.request_meta)}`);
    // In full: the whole point is what SiteX said, and a truncated body is
    // what cost the candidate count on the Santa Ana investigation.
    console.log(`    response: ${JSON.stringify(r.response_meta)}`);
  }

  if (profiles.length === 0 && rows.length === 0) {
    console.log('\n  NOTHING LOGGED for that address. Either it was never submitted,');
    console.log('  or it failed in the browser before reaching the server.');
  }
  console.log('');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
