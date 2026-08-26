/**
 * READ-ONLY. Calibration for the entity-marker list, against every owner string
 * we have stored. ~965 abstentions means calibrated; materially more means it is
 * suppressing real people and must not ship.
 */
import postgres from 'postgres';
import { entityMarker } from '../../src/lib/domain/orders/names/entity-markers';
import { parseSiteXOwners } from '../../src/lib/domain/orders/names/sitex-owner-names';

const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
(async () => {
  const rows = await sql.unsafe(`
    select primary_owner from order_properties
    where nullif(trim(primary_owner),'') is not null`);
  const owners = rows.map((r) => String(r.primary_owner));
  console.log(`owner strings: ${owners.length}\n`);

  const byToken = new Map<string, string[]>();
  const branches = new Map<string, number>();
  let abstain = 0;

  for (const o of owners) {
    const m = entityMarker(o);
    if (m.matched) { abstain++; (byToken.get(m.token) ?? byToken.set(m.token, []).get(m.token)!).push(o); }
    branches.set(parseSiteXOwners(o).branch, (branches.get(parseSiteXOwners(o).branch) ?? 0) + 1);
  }

  const pct = ((abstain / owners.length) * 100).toFixed(1);
  console.log(`ABSTENTIONS: ${abstain} of ${owners.length}  (${pct}%)`);
  console.log(`ticket's entity estimate: 965 of 5,384 (17.9%)\n`);

  console.log('branch taken (no deed available for stored strings, so none are *-deed):');
  for (const [b, n] of [...branches.entries()].sort((a, b2) => b2[1] - a[1])) {
    console.log(`   ${b.padEnd(16)} ${String(n).padStart(5)}`);
  }

  console.log('\nby marker, with samples:');
  for (const [t, list] of [...byToken.entries()].sort((a, b2) => b2[1].length - a[1].length)) {
    console.log(`   ${t.padEnd(16)} ${String(list.length).padStart(4)}   ${list.slice(0, 2).map((x) => x.slice(0, 34)).join(' | ')}`);
  }

  // The dangerous direction: what did it catch that has NO obvious org word?
  console.log('\nSUPPRESSED STRINGS WITH NO LLC/INC/CORP/TRUST — check these for real people:');
  const OBVIOUS = /\b(LLC|INC|CORP|TRUST|COMPANY|LTD|PARTNERSHIP)\b/i;
  const subtle = owners.filter((o) => entityMarker(o).matched && !OBVIOUS.test(o));
  console.log(`   ${subtle.length} of ${abstain}`);
  for (const s of subtle.slice(0, 25)) console.log(`     ${s.slice(0, 62)}`);
  await sql.end(); process.exit(0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
