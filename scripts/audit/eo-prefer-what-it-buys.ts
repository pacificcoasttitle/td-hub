/**
 * READ-ONLY. What does preferring the officer-feed row actually change?
 *
 * Every consumer of orders.escrow_officer_id reads some column off the contact
 * it points at. This dumps, for each of the four duplicated officers, the exact
 * columns each consumer reads from BOTH rows, so the answer is a diff rather
 * than an argument. It also reports whether the resolver's output can reach
 * order_parties.contact_id at all.
 *
 *   npx tsx --env-file=.env.local scripts/audit/eo-prefer-what-it-buys.ts
 */
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });

const PAIRS: [string, number, number][] = [
  ['Anna Ballesteros', 12, 17165],
  ['Joseph Gomez', 14, 10999],
  ['Karla Casco', 15, 10642],
  ['Lupe Vidaca', 16, 8996],
];

/** Column, and which consumer of orders.escrow_officer_id reads it. */
const READS: [string, string][] = [
  ['email', 'prelim primary recipient; confirmation escrow CC; party-wizard invite address'],
  ['full_name', 'prelim recipient name; confirmation escrow block'],
  ['officer_name', 'order read-model / hub table officer column'],
  ['phone', 'party wizard escrow contact block'],
  ['company_name', 'party wizard context (suppressed when Pacific Coast)'],
  ['office_lookup_code', 'NOT read from the escrow officer anywhere — payload reads the TITLE officer'],
  ['softpro_lookup_code', 'create-order payload LookUpCodeEscrowOfficer (create path only)'],
  ['is_active', 'contact admin surfaces'],
];

type Row = Record<string, unknown>;

(async () => {
  const [{ now }] = await sql.unsafe(`select now() at time zone 'utc' as now`) as unknown as Row[];
  console.log(`run (db utc): ${now}\n`);

  console.log('=== column-by-column diff of the two rows each officer has ===');
  for (const [name, officerRow, addressBookRow] of PAIRS) {
    const rows = await sql.unsafe(`
      select id, email, phone, full_name, officer_name, company_name,
             lookup_code, office_lookup_code, softpro_lookup_code, source_id,
             is_active, is_escrow_officer, type, roles::text as roles
        from contacts where id in ($1, $2)
    `, [officerRow, addressBookRow]) as unknown as Row[];
    const a = rows.find((r) => r.id === officerRow)!;
    const b = rows.find((r) => r.id === addressBookRow)!;

    console.log(`\n${name} — officer-feed row ${officerRow} vs address-book row ${addressBookRow}`);
    console.log('  ' + 'column'.padEnd(22) + `officer ${officerRow}`.padEnd(26)
      + `address-book ${addressBookRow}`.padEnd(26) + 'same?');
    for (const [col] of READS) {
      const av = JSON.stringify(a[col] ?? null);
      const bv = JSON.stringify(b[col] ?? null);
      console.log('  ' + col.padEnd(22) + av.slice(0, 25).padEnd(26) + bv.slice(0, 25).padEnd(26)
        + (av === bv ? 'same' : 'DIFFERENT'));
    }
  }

  console.log('\n\n=== which consumer reads which column ===');
  for (const [col, who] of READS) console.log(`  ${col.padEnd(22)}${who}`);

  // ── can this resolver's output reach order_parties.contact_id? ────────────
  console.log('\n\n=== order_parties rows pointing at these contacts, and their roles ===');
  const parties = await sql.unsafe(`
    select p.contact_id, p.role, count(*)::int as n
      from order_parties p
     where p.contact_id in (12,14,15,16,8996,10642,10999,17165)
     group by p.contact_id, p.role
     order by p.contact_id, p.role
  `) as unknown as Row[];
  console.log('  ' + 'contact'.padEnd(10) + 'role'.padEnd(20) + 'rows');
  for (const r of parties) {
    console.log('  ' + String(r.contact_id).padEnd(10) + String(r.role).padEnd(20) + r.n);
  }
  console.log('  (loadEscrowOfficers writes orders.escrow_officer_id only — order_parties.contact_id');
  console.log('   is written by enrich-orders from the GetOrderContacts lookup codes, a different path.)');

  // ── the scoping consumer ──────────────────────────────────────────────────
  console.log('\n=== who could see these orders in the escrow-officer dashboard ===');
  const profs = await sql.unsafe(`
    select pr.id, pr.display_name, pr.email, pr.role, pr.contact_id, pr.is_active
      from profiles pr
     where pr.contact_id in (12,14,15,16,8996,10642,10999,17165)
        or pr.role = 'escrow_officer'
  `) as unknown as Row[];
  console.log(`  profiles with role='escrow_officer' or linked to any of the eight rows: ${profs.length}`);
  for (const p of profs) console.log(`    ${JSON.stringify(p)}`);

  const [{ n: totalProfiles }] = await sql.unsafe(
    `select count(*)::int as n from profiles`,
  ) as unknown as Row[];
  const byRole = await sql.unsafe(
    `select role, count(*)::int as n from profiles group by role order by 2 desc`,
  ) as unknown as Row[];
  console.log(`  profiles in total: ${totalProfiles}`);
  console.log('  ' + byRole.map((r) => `${r.role}=${r.n}`).join(', '));

  // ── officer CC defaults ───────────────────────────────────────────────────
  const [{ n: ccRows }] = await sql.unsafe(
    `select count(*)::int as n from officer_cc_defaults`,
  ) as unknown as Row[];
  console.log(`\n=== officer_cc_defaults rows in the whole table: ${ccRows} ===`);

  // ── existing data that stays wrong ────────────────────────────────────────
  console.log('\n=== existing rows still pointing at the address-book row ===');
  const stale = await sql.unsafe(`
    select 'orders.escrow_officer_id' as ref, o.escrow_officer_id as contact_id, count(*)::int as n
      from orders o where o.escrow_officer_id in (8996,10642,10999,17165)
     group by 2
    union all
    select 'orders.client_contact_id', o.client_contact_id, count(*)::int
      from orders o where o.client_contact_id in (8996,10642,10999,17165)
     group by 2
    union all
    select 'order_parties.contact_id', p.contact_id, count(*)::int
      from order_parties p where p.contact_id in (8996,10642,10999,17165)
     group by 2
     order by 1, 2
  `) as unknown as Row[];
  console.log('  ' + 'reference'.padEnd(28) + 'contact'.padEnd(10) + 'rows');
  for (const r of stale) {
    console.log('  ' + String(r.ref).padEnd(28) + String(r.contact_id).padEnd(10) + r.n);
  }

  console.log('\n=== how many of those orders are still live (a resync would rewrite them) ===');
  const live = await sql.unsafe(`
    select o.operational_status, count(*)::int as n
      from orders o where o.escrow_officer_id in (8996,10642,10999,17165)
     group by 1 order by 2 desc
  `) as unknown as Row[];
  for (const r of live) console.log(`  ${String(r.operational_status).padEnd(14)} ${r.n}`);

  await sql.end();
  process.exit(0);
})();
