/**
 * READ ONLY, NO VENDOR CALL. What did the APN retry actually come back with?
 *
 * Profile 45 is the operator's pick from the unit picker: searched by
 * apn=930-371-05 + fips=06059, charged one credit, and was then refused by our
 * own guard as "SiteX did not recognise this address" with isValidAddress
 * false and matchMethod FA.
 *
 * The question that decides the fix: did SiteX return the PROPERTY, or
 * nothing? If the Feed is populated, the guard threw away data we paid for.
 *
 *   npx tsx --env-file=.env.local scripts/audit/concierge-apn-retry-payload.ts 45
 */
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { conciergeProfiles } from '@/lib/db/schema/concierge';
import { downloadFile } from '@/lib/integrations/s3/client';

async function main() {
  const id = Number(process.argv[2] ?? '45');
  const [p] = await db.select().from(conciergeProfiles).where(eq(conciergeProfiles.id, id)).limit(1);
  if (!p) { console.error(`profile ${id} not found`); process.exit(1); }

  console.log(`\n=== profile ${id} — ${p.requestedAddress} ===`);
  console.log(`  status        : ${p.status}`);
  console.log(`  credits       : ${p.sitexCreditsCharged}`);
  console.log(`  requested apn : ${p.requestedApn ?? '-'}  fips ${p.requestedFips ?? '-'}`);
  console.log(`  guard         : isValid=${p.isValidAddress} outside=${p.outsideCoverage} count=${p.locationCount} method=${p.matchMethodCode}`);
  console.log(`  error         : ${p.errorMessage}`);
  console.log(`  raw payload   : ${p.rawStorageKey ?? 'NOT STORED'}`);

  if (!p.rawStorageKey) {
    console.log('\n  The raw payload was NOT stored. generate.ts archives it only after the');
    console.log('  guard passes, so a guard refusal discards what the credit bought.');
    console.log('  What SiteX returned can only be read from the vendor log for this call.');
    process.exit(0);
  }

  const got = await downloadFile(p.rawStorageKey);
  if (!got.success || !got.data) { console.error('payload unreadable'); process.exit(1); }
  const body = JSON.parse(got.data.toString('utf8')) as Record<string, unknown>;

  console.log('\n=== what SiteX sent ===');
  console.log(`  top-level keys : ${Object.keys(body).join(', ')}`);
  const oi = (body.OrderInfo ?? {}) as Record<string, unknown>;
  console.log(`  OrderInfo      : ${JSON.stringify(oi)}`);
  const locs = body.Locations as unknown[] | undefined;
  console.log(`  Locations      : ${Array.isArray(locs) ? locs.length : 'absent'}`);

  const feed = (body.Feed ?? null) as Record<string, unknown> | null;
  console.log(`  Feed           : ${feed === null ? 'NULL' : `${Object.keys(feed).length} section(s): ${Object.keys(feed).join(', ')}`}`);

  if (feed) {
    const pp = (feed.PropertyProfile ?? {}) as Record<string, unknown>;
    // The handful of fields that say whether this is the real property.
    for (const k of ['APN', 'FIPS', 'PrimaryOwnerName', 'SiteAddress', 'SiteCity', 'SiteState', 'SiteZip', 'UseCodeDescription']) {
      if (k in pp) console.log(`    PropertyProfile.${k} = ${JSON.stringify(pp[k])}`);
    }
    console.log(`\n  VERDICT: the Feed ${Object.keys(feed).length > 0 ? 'IS POPULATED — the guard refused data we paid for' : 'is empty'}.`);
  }
  console.log('');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
