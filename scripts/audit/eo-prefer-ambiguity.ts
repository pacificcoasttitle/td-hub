/**
 * READ-ONLY. Is the CURRENT resolver ambiguous, right now, in production?
 *
 * loadEscrowOfficers has no ORDER BY and the resolvers take the first array
 * element that matches, so the answer is whatever order postgres hands the rows
 * back in. That only mattered while the officer-feed rows were unflagged. The
 * concurrent syncEscrowOfficers work flagged them, so both rows of the same
 * person are now in the candidate set and the tie is live.
 *
 * This prints the physical scan order the loader query actually returns, and
 * which row first-wins therefore picks today.
 *
 *   npx tsx --env-file=.env.local scripts/audit/eo-prefer-ambiguity.ts
 */
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });

type Row = Record<string, unknown>;

const PAIRS: [string, number, number][] = [
  ['Anna Ballesteros', 12, 17165],
  ['Joseph Gomez', 14, 10999],
  ['Karla Casco', 15, 10642],
  ['Lupe Vidaca', 16, 8996],
];

(async () => {
  const [{ now }] = await sql.unsafe(`select now() at time zone 'utc' as now`) as unknown as Row[];
  console.log(`run (db utc): ${now}`);

  const flags = await sql.unsafe(`
    select id, full_name, is_escrow_officer, office_lookup_code, email, phone, ctid::text as ctid
      from contacts where id in (12,14,15,16,8996,10642,10999,17165) order by id
  `) as unknown as Row[];
  console.log('\n=== is_escrow_officer on each of the eight rows, now ===');
  console.log('  ' + 'id'.padEnd(9) + 'name'.padEnd(22) + 'is_eo'.padEnd(8)
    + 'office'.padEnd(9) + 'email'.padEnd(26) + 'phone'.padEnd(16) + 'ctid');
  for (const r of flags) {
    console.log('  ' + String(r.id).padEnd(9) + String(r.full_name).padEnd(22)
      + String(r.is_escrow_officer).padEnd(8) + String(r.office_lookup_code ?? '(null)').padEnd(9)
      + String(r.email ?? '(null)').padEnd(26) + String(r.phone ?? '(null)').padEnd(16) + r.ctid);
  }

  // The loader query verbatim, no ORDER BY — the order the resolver sees.
  const scan = await sql.unsafe(`
    select id, full_name from contacts where is_escrow_officer = true
  `) as unknown as Row[];
  console.log(`\n=== loadEscrowOfficers() today: ${scan.length} rows, no ORDER BY ===`);
  console.log('  which row first-wins picks for each duplicated officer:');
  for (const [name, officerRow, addressBookRow] of PAIRS) {
    const a = scan.findIndex((r) => r.id === officerRow);
    const b = scan.findIndex((r) => r.id === addressBookRow);
    const inSet = (i: number) => (i < 0 ? 'not a candidate' : `position ${i}`);
    let winner: string;
    if (a < 0 && b < 0) winner = 'neither';
    else if (a < 0) winner = String(addressBookRow);
    else if (b < 0) winner = String(officerRow);
    else winner = String(a < b ? officerRow : addressBookRow);
    console.log(`  ${name.padEnd(20)} officer ${officerRow} ${inSet(a).padEnd(18)}`
      + ` address-book ${addressBookRow} ${inSet(b).padEnd(18)} -> picks ${winner}`
      + (a >= 0 && b >= 0 ? '   (AMBIGUOUS: both in set, no ORDER BY)' : ''));
  }

  const ambiguous = PAIRS.filter(([, o, ab]) =>
    scan.some((r) => r.id === o) && scan.some((r) => r.id === ab));
  console.log(`\n  officers whose resolution is currently decided by scan order: ${ambiguous.length}`);

  await sql.end();
  process.exit(0);
})();
