/**
 * READ-ONLY. Of the abstentions, which are matched ONLY by TRUSTEE?
 * If a genuine entity relies on TRUSTEE alone, dropping it loses that entity.
 */
import postgres from 'postgres';
import { entityMarker } from '../../src/lib/domain/orders/names/entity-markers';
const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });

/** Re-run matching with TRUSTEE/TRUSTEES removed, to see who still matches. */
const OTHER = /\b(LLC|L\.?L\.?C|LLP|PLLC|INC|INCORPORATED|CORP|CORPORATION|COMPANY|LTD|LIMITED|PARTNERSHIP|PARTNERS|TRUST|TRUSTS|FOUNDATION|ASSOCIATION|ASSOCIATES|ORGANIZATION|HOLDINGS|INVESTMENTS?|VENTURES|CAPITAL|GROUP|PROPERTIES|REALTY|ENTERPRISES|DEVELOPMENT|MANAGEMENT|CHURCH|MINISTRIES|BANK)\b/i;

(async () => {
  const rows = await sql.unsafe(`select primary_owner from order_properties where nullif(trim(primary_owner),'') is not null`);
  const owners = rows.map(r => String(r.primary_owner));
  const abstained = owners.filter(o => entityMarker(o).matched);
  const trusteeOnly = abstained.filter(o => /\bTRUSTEES?\b/i.test(o) && !OTHER.test(o));

  console.log(`abstentions: ${abstained.length}`);
  console.log(`matched by TRUSTEE/TRUSTEES and NOTHING else: ${trusteeOnly.length}\n`);
  const uniq = [...new Set(trusteeOnly)];
  console.log(`distinct strings: ${uniq.length}`);
  for (const s of uniq) console.log(`   ${s}`);
  await sql.end(); process.exit(0);
})();
