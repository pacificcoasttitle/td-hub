/**
 * Backfill the address SoftPro already holds onto the contacts where we hold
 * neither address nor zip.
 *
 * WHY THIS IS A SAFETY FIX AND NOT HOUSEKEEPING
 *
 * The edit modal now marks Address/ZIP/City/State `required` inside a real
 * <form onSubmit>, so an operator can no longer save a contact with a blank
 * address — the browser refuses the submit. That closed the silent-blanking
 * hole. What it did NOT close: for these rows the modal opens with the required
 * address field EMPTY, because our row has nothing to prefill it with. To
 * change a phone number the operator must first type an address they cannot
 * see, and whatever they type replaces the real one SoftPro holds. The failure
 * moved from "silently blanked" to "silently replaced with a guess".
 *
 * 86 of the 120 are listed on a page where the edit button is visible today —
 * 79 of them on /contacts/real-estate-agents, which does not pass requireName.
 * The nameless-row filter does not cover this population: 106 of the 120 carry
 * a name in `full_name`, so the filter never sees them.
 *
 * SCOPE. Only rows where address1 AND zip are both empty, and only where the
 * scan holds something to give. The 33 SoftPro is blank for are left alone —
 * there is nothing to copy. The 13 whose lookup code is absent from the scan
 * are left alone and reported separately; six of them carry a UI button label
 * ("New", "Add", "UPD") where a lookup code should be.
 *
 * Writes to our own table only. No SoftPro call, no UpdateUser, no vendor
 * mutation of any kind.
 *
 * Usage:  npx tsx --env-file=.env.local scripts/one-off/backfill-74-addresses.mts <scan.json> [--commit]
 */
import postgres from 'postgres';
import { readFileSync } from 'node:fs';

interface ScanRow {
  code: string; first: string; last: string; company: string;
  address1: string; city: string; state: string; zip: string; email: string;
}

const scanPath = process.argv[2];
const commit = process.argv.includes('--commit');
if (!scanPath) {
  console.error('usage: backfill-74-addresses.mts <scan.json> [--commit]');
  process.exit(1);
}

const scan = JSON.parse(readFileSync(scanPath, 'utf8')) as ScanRow[];
const byCode = new Map<string, ScanRow>();
for (const row of scan) if (row.code) byCode.set(row.code.toLowerCase(), row);

// The control that aborts a scan built from the wrong column. A person-code
// scan is near-unique; a company-code scan collapses to a fraction of the rows.
const ratio = byCode.size / scan.length;
if (ratio <= 0.8) {
  console.error(`ABORT: distinct/rows = ${ratio.toFixed(2)}, expected > 0.80. `
    + 'The scan is probably keyed on the company code, not the person code.');
  process.exit(1);
}
console.log(`scan: ${scan.length} rows, ${byCode.size} distinct codes, control ${ratio.toFixed(2)} OK`);

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require', max: 1 });

const targets = await sql<{ id: number; code: string; fullName: string | null }[]>`
  SELECT id, softpro_lookup_code AS code, full_name AS "fullName"
  FROM contacts
  WHERE type = 'person'
    AND coalesce(softpro_lookup_code, '') <> ''
    AND NOT (is_title_officer OR is_escrow_officer OR is_sales_rep)
    AND coalesce(address1, '') = '' AND coalesce(zip, '') = ''
  ORDER BY id`;
console.log(`contacts holding neither address nor zip: ${targets.length}`);

const writes: { id: number; code: string; name: string; row: ScanRow }[] = [];
let blankInSoftPro = 0;
let absentFromScan = 0;

for (const target of targets) {
  const row = byCode.get(String(target.code).toLowerCase());
  if (!row) { absentFromScan++; continue; }
  if (!row.address1 && !row.zip) { blankInSoftPro++; continue; }
  writes.push({ id: target.id, code: target.code, name: target.fullName ?? '', row });
}

console.log(`  to write            : ${writes.length}`);
console.log(`  blank in SoftPro too: ${blankInSoftPro}  (left alone)`);
console.log(`  absent from the scan: ${absentFromScan}  (left alone)`);

if (!commit) {
  console.log('\nDRY RUN — pass --commit to write. Sample:');
  for (const w of writes.slice(0, 10)) {
    console.log(`   ${String(w.id).padEnd(7)}${w.code.padEnd(13)}${w.name.padEnd(22)}`
      + `-> ${[w.row.address1, w.row.city, w.row.state, w.row.zip].filter(Boolean).join(', ')}`);
  }
  await sql.end();
  process.exit(0);
}

let written = 0;
const failures: { id: number; message: string }[] = [];
for (const w of writes) {
  try {
    // Guarded on the same emptiness the selection used, so a row that gained an
    // address between the SELECT and here is never overwritten.
    const result = await sql`
      UPDATE contacts SET
        address1 = ${w.row.address1 || null},
        city     = ${w.row.city || null},
        state    = ${w.row.state || null},
        zip      = ${w.row.zip || null},
        updated_at = now()
      WHERE id = ${w.id}
        AND coalesce(address1, '') = '' AND coalesce(zip, '') = ''`;
    written += result.count;
  } catch (err) {
    // Persist nothing silently — a row that will not take its address is a
    // result, not a non-event.
    failures.push({ id: w.id, message: err instanceof Error ? err.message : String(err) });
  }
}

console.log(`\nwritten: ${written} of ${writes.length}`);
if (failures.length > 0) {
  console.log('failures:');
  for (const f of failures) console.log(`   ${f.id}  ${f.message}`);
}

const [after] = await sql<{ n: number }[]>`
  SELECT count(*)::int AS n FROM contacts
  WHERE type = 'person' AND coalesce(softpro_lookup_code, '') <> ''
    AND NOT (is_title_officer OR is_escrow_officer OR is_sales_rep)
    AND coalesce(address1, '') = '' AND coalesce(zip, '') = ''`;
console.log(`contacts still holding neither address nor zip: ${after!.n}`);

await sql.end();
process.exit(0);
