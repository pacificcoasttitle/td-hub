/**
 * SPENDS ONE SiteX CREDIT. Approved by Gerard, 16 Oct 2026, for this parcel.
 *
 * Verifies the defect a rep hit on 25651 Paseo La Cresta: the condo picker
 * appeared, the rep picked the unit, and fetching that unit BY PARCEL was
 * refused by our own IsValidAddress check — which a parcel search has no
 * address to satisfy. It had failed that way since the picker shipped,
 * charging a credit each time.
 *
 * ─── WHAT THIS PROVES, AND WHAT IT CANNOT ───────────────────────────────────
 *
 * It calls fetchConciergeProfile() with apn + fips — the exact call the
 * picker's Confirm and the new APN mode both make — and then runs
 * evaluateGuard() over the evidence SiteX returns. That is precisely the
 * defect: SiteX answered with the property and the guard threw it away.
 *
 * IT DOES NOT go through generateConciergeProfile(), and not by choice.
 * generate.ts imports through `@/` aliases, which sends tsx down its CJS
 * resolver, where @react-pdf/textkit's import of hyphenate/en-us has no
 * `require` condition — the script dies at import before it can run. A patch
 * for that was tried once and CHANGED WHAT THE RENDERER PRODUCED (it enabled
 * hyphenation), so it is not coming back for a verification run.
 *
 * So the archive-on-charge path and the render are NOT exercised here. They
 * need one click on the deployed route, which is said plainly in the output
 * rather than glossed.
 *
 * ─── ONE PARCEL, NAMED IN THE CODE ──────────────────────────────────────────
 *
 * A credit is real money and a typo is somebody else's property.
 *
 *   npx tsx --env-file=.env.local scripts/audit/verify-parcel-search.mts --spend
 */
import {
  evaluateGuard, fetchConciergeProfile,
} from '../../src/lib/integrations/sitex/concierge-feed';

const APPROVED = {
  apn: '930-371-05',
  fips: '06059',
  county: 'Orange',
  describedAs: '25651 Paseo La Cresta, Laguna Niguel (unit #45)',
};

(async () => {
  if (!process.argv.includes('--spend')) {
    console.log('\nThis SPENDS ONE SiteX CREDIT. Re-run with --spend to confirm.\n');
    console.log(`  parcel : APN ${APPROVED.apn}, FIPS ${APPROVED.fips} (${APPROVED.county} County)`);
    console.log(`  that is: ${APPROVED.describedAs}\n`);
    process.exit(0);
  }

  console.log('\n=== the call SiteX refused for three weeks ===');
  console.log(`  apn ${APPROVED.apn}  fips ${APPROVED.fips}\n`);

  const started = Date.now();
  const r = await fetchConciergeProfile({
    // No postal address — that is the whole point of a parcel search.
    street: '', city: '', state: 'CA', zip: '',
    apn: APPROVED.apn,
    fips: APPROVED.fips,
  });
  const took = Date.now() - started;

  console.log(`  took          : ${(took / 1000).toFixed(1)}s`);
  console.log(`  ok            : ${r.ok}`);
  console.log(`  credits       : ${r.creditsCharged}`);
  if (!r.ok) console.log(`  reason        : ${r.reason}\n  message       : ${r.message}`);

  const g = r.guard;
  console.log('\n=== what SiteX said about the parcel ===');
  console.log(`  searchId        : ${g?.searchId ?? '-'}`);
  console.log(`  isValidAddress  : ${g?.isValidAddress}   <- false on a parcel search, and meaningless`);
  console.log(`  outsideCoverage : ${g?.outsideCoverage}`);
  console.log(`  locationCount   : ${g?.locationCount}`);
  console.log(`  matchMethodCode : ${g?.matchMethodCode}`);
  console.log(`  bytes returned  : ${r.ok ? r.raw.length.toLocaleString() : ('raw' in r && r.raw ? r.raw.length.toLocaleString() : 'none')}`);

  if (g) {
    // The fix, stated as a comparison rather than a claim.
    const asParcel = evaluateGuard(g, 'parcel');
    const asAddress = evaluateGuard(g, 'address');
    console.log('\n=== the guard, both ways ===');
    console.log(`  evaluateGuard(evidence, 'parcel')  = ${asParcel ?? 'PASS'}`);
    console.log(`  evaluateGuard(evidence, 'address') = ${asAddress ?? 'PASS'}   <- what it used to do`);
  }

  if (r.ok) {
    // Read the property back out of the payload: the point is that it is the
    // right unit, not merely that something came back.
    const feed = (r.payload.Feed ?? {}) as Record<string, unknown>;
    const pp = (feed.PropertyProfile ?? {}) as Record<string, unknown>;
    console.log('\n=== the property SiteX returned ===');
    for (const k of ['APN', 'FIPS', 'PrimaryOwnerName', 'SiteAddress', 'SiteCity', 'SiteZip', 'UseCodeDescription']) {
      if (k in pp) console.log(`  ${k.padEnd(18)}: ${JSON.stringify(pp[k])}`);
    }
    const right = String(pp.APN ?? '').replace(/\D/g, '') === APPROVED.apn.replace(/\D/g, '');
    console.log(`\n  the parcel we asked for: ${right}`);
  }

  console.log('\n=== VERDICT ===');
  console.log(`  parcel search accepted : ${r.ok}`);
  console.log('\n  NOT PROVEN HERE, and needs one click on the deployed route:');
  console.log('    - the archive-on-charge path (generate.ts)');
  console.log('    - the document render');
  console.log('    - the confirmation panel as an operator sees it');
  console.log('');
  process.exit(r.ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
