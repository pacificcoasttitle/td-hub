/**
 * SPENDS ONE SiteX CREDIT. Approved by Gerard, 16 Oct 2026, for this parcel.
 *
 * Verifies the fix for the defect a rep hit on 25651 Paseo La Cresta: the
 * condo picker appeared, the rep picked the unit, and fetching that unit BY
 * PARCEL was refused by our own IsValidAddress check — which a parcel search
 * has no address to satisfy. It had failed that way since the picker shipped,
 * charging a credit each time.
 *
 * ─── WHAT IT EXERCISES ──────────────────────────────────────────────────────
 *
 * generateConciergeProfile() with apn + fips, which is exactly what the
 * picker's Confirm and the new APN mode both send. That is the path that was
 * broken: the guard, the archive-on-charge, and the render.
 *
 * It does NOT go through the HTTP route, because that needs an operator
 * session. The route is a thin wrapper over this call and routes.test.ts holds
 * its shape; the UI is covered by its own tests. What could only be proven
 * against the live vendor is whether SiteX's parcel answer now passes.
 *
 * ─── IT WILL ONLY RUN AGAINST THE APPROVED PARCEL ───────────────────────────
 *
 * One parcel, named here. A credit is real money and a typo is somebody's
 * property, so the allow-list is in the code rather than in the operator's
 * care.
 *
 * RELATIVE IMPORTS AND .mts: `@/` aliases send tsx through its CJS resolver,
 * where @react-pdf/textkit's import of hyphenate/en-us has no `require`
 * condition and the script dies before rendering. Same reason as
 * concierge-render-preview.mts.
 *
 *   npx tsx --env-file=.env.local scripts/audit/verify-parcel-search.mts --spend
 */
import { eq } from 'drizzle-orm';
import { db } from '../../src/lib/db/client';
import { conciergeProfiles } from '../../src/lib/db/schema/concierge';
import { generateConciergeProfile } from '../../src/lib/domain/concierge/generate';

/** The one parcel this may be run against. */
const APPROVED = {
  apn: '930-371-05',
  fips: '06059',
  county: 'Orange',
  describedAs: '25651 Paseo La Cresta, Laguna Niguel (unit #45)',
};

(async () => {
  const spend = process.argv.includes('--spend');
  if (!spend) {
    console.log('\nThis SPENDS ONE SiteX CREDIT. Re-run with --spend to confirm.\n');
    console.log(`  parcel : APN ${APPROVED.apn}, FIPS ${APPROVED.fips} (${APPROVED.county} County)`);
    console.log(`  that is: ${APPROVED.describedAs}\n`);
    process.exit(0);
  }

  console.log(`\n=== BEFORE ===`);
  const before = await db.select({
    id: conciergeProfiles.id,
    status: conciergeProfiles.status,
    credits: conciergeProfiles.sitexCreditsCharged,
    error: conciergeProfiles.errorMessage,
  }).from(conciergeProfiles).where(eq(conciergeProfiles.requestedApn, APPROVED.apn));
  console.log(`  profiles already on this parcel: ${before.length}`);
  for (const b of before) console.log(`    ${b.id}  ${b.status}  credits=${b.credits}  ${b.error ?? ''}`);

  console.log('\n=== THE CALL — one credit, by parcel ===');
  const started = Date.now();
  const outcome = await generateConciergeProfile({
    // What APN mode sends: no postal address, the parcel and the county.
    street: `APN ${APPROVED.apn}`,
    city: APPROVED.county,
    state: 'CA',
    apn: APPROVED.apn,
    fips: APPROVED.fips,
    preparedForName: 'Verification run',
    preparedForCompany: null,
    presentingRep: { name: 'Mark Neveu', email: null, phone: null, title: null },
    createdBy: 'script:verify-parcel-search',
    // The same parcel has three failed rows on it. Those are not profiles we
    // hold, but say so explicitly rather than rely on the duplicate check
    // ignoring failures.
    allowDuplicate: true,
  });
  const took = Date.now() - started;

  console.log(`  took      : ${(took / 1000).toFixed(1)}s`);
  console.log(`  ok        : ${outcome.ok}`);
  console.log(`  profileId : ${'profileId' in outcome ? outcome.profileId : '-'}`);
  console.log(`  credits   : ${outcome.creditsCharged}`);
  console.log(`  message   : ${'message' in outcome ? outcome.message : '(none)'}`);

  const id = 'profileId' in outcome ? outcome.profileId : null;
  if (!id) { console.log('\nNo profile row. Nothing further to read.'); process.exit(1); }

  const [row] = await db.select().from(conciergeProfiles).where(eq(conciergeProfiles.id, id)).limit(1);
  if (!row) { console.log('\nRow vanished.'); process.exit(1); }

  console.log('\n=== THE ROW ===');
  console.log(`  status        : ${row.status}`);
  console.log(`  asked for     : ${row.requestedAddress} / ${row.requestedCity ?? ''}`);
  console.log(`  searched by   : apn=${row.requestedApn ?? '-'} fips=${row.requestedFips ?? '-'}`);
  console.log(`  guard         : isValid=${row.isValidAddress} outside=${row.outsideCoverage} count=${row.locationCount} method=${row.matchMethodCode}`);
  console.log(`  subject       : apn=${row.subjectApn ?? '-'} fips=${row.subjectFips ?? '-'} county=${row.subjectCounty ?? '-'}`);
  console.log(`  resolved addr : ${row.listSubject ?? '-'} / ${row.listSubjectDetail ?? '-'}`);
  console.log(`  owner         : ${row.subjectUseDescription ?? '-'}`);
  console.log(`  raw archived  : ${row.rawStorageKey ?? 'NOT STORED'}  ${row.rawBytes ?? 0} bytes`);
  console.log(`  pdf           : ${row.pdfStorageKey ?? '-'}  ${row.pdfPageCount ?? 0} pages`);
  console.log(`  credits       : ${row.sitexCreditsCharged}`);
  console.log(`  error         : ${row.errorMessage ?? '(none)'}`);

  // What the fix was for, stated as the pass condition rather than inferred.
  const guardPassed = row.status !== 'failed' || row.errorMessage?.includes('recognise') === false;
  const archived = Boolean(row.rawStorageKey);
  const rendered = Boolean(row.pdfStorageKey);

  console.log('\n=== VERDICT ===');
  console.log(`  parcel search accepted (was "did not recognise this address") : ${guardPassed}`);
  console.log(`  payload archived even though a credit was charged             : ${archived}`);
  console.log(`  document rendered                                             : ${rendered}`);
  console.log(`\n${outcome.ok && archived && rendered ? 'VERIFIED.' : 'NOT VERIFIED — read the row above.'}`);
  console.log('');
  process.exit(outcome.ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
