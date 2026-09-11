/**
 * Erika Valencia (Escrow360) — collapse two hub-minted duplicates onto the
 * record SoftPro already held. Approved by Gerard 2026-09-11.
 *
 * WHAT HAPPENED. SoftPro had held `EriValEscr` (erika@escrow360inc.com,
 * company Escr805W) since at least the 2026-09-09 scan. Our table did not —
 * she was one of the contacts the backfill never brought across — so Aileen
 * searched, found nothing, and created her. CreateUser rejected `EriValEscr` as
 * a duplicate key, and the retry assumed the code belonged to someone else and
 * minted `EriValEscr1` (#23074). It is eleven characters, so the first order
 * naming her failed "Value must be no longer than 10 characters." She was then
 * created again as `EriValEscr2` (#23075). Neither code can ever be used on an
 * order. SoftPro's own order 20022085-GLT names `EriValEscr`.
 *
 * WHAT THIS DOES, in one transaction:
 *   1. inserts `EriValEscr` as a contact, with what SoftPro holds for her
 *   2. links it to Escrow360 Inc. (company 6250), as the duplicates were
 *   3. deactivates #23074 and #23075 — nothing else references them
 *   4. points order 8607's escrow party (order_parties 38752) at the new row
 *   5. records the change in admin_activity_logs
 *
 * Both is_escrow and is_escrow_officer are set: is_escrow is what the Parties
 * picker searches, is_escrow_officer is what the Escrow Employees page filters.
 * Until that mismatch is fixed, one flag alone would hide her from one of them.
 *
 * Our table only. EriValEscr1 and EriValEscr2 still exist in SoftPro; there is
 * no delete endpoint and removing them was not part of the approval.
 *
 * Usage: npx tsx --env-file=.env.local scripts/one-off/cleanup-erika-duplicates.mts [--commit]
 */
import postgres from 'postgres';

const commit = process.argv.includes('--commit');
const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require', max: 1 });

const DUPLICATES = [23074, 23075];
const PARTY_ROW = 38752;
const ORDER_ID = 8607;
const COMPANY_ID = 6250;

async function preflight(): Promise<void> {
  const held = await sql`SELECT id FROM contacts WHERE softpro_lookup_code = 'EriValEscr' OR lookup_code = 'EriValEscr'`;
  if (held.length) throw new Error(`ABORT: EriValEscr already held locally by #${held.map((h) => h.id).join(', #')}`);

  const dups = await sql<{ id: number; softpro_lookup_code: string; email: string; is_active: boolean }[]>`
    SELECT id, softpro_lookup_code, email, is_active FROM contacts WHERE id = ANY(${DUPLICATES}) ORDER BY id`;
  const expected = ['EriValEscr1', 'EriValEscr2'];
  const asApproved = dups.length === 2 && dups.every((d, i) =>
    d.softpro_lookup_code === expected[i] && d.email.toLowerCase() === 'erika@escrow360inc.com');
  if (!asApproved) throw new Error(`ABORT: duplicates are not what was approved: ${JSON.stringify(dups)}`);

  const [party] = await sql<{ order_id: number; role: string; contact_id: number | null; external_email: string | null }[]>`
    SELECT order_id, role, contact_id, external_email FROM order_parties WHERE id = ${PARTY_ROW}`;
  const partyOk = party && party.order_id === ORDER_ID && party.role === 'escrow_company'
    && party.contact_id === null && (party.external_email ?? '').toLowerCase() === 'erika@escrow360inc.com';
  if (!partyOk) throw new Error(`ABORT: order_parties ${PARTY_ROW} is not the unlinked Erika escrow party: ${JSON.stringify(party)}`);

  const refs: [string, string][] = [
    ['order_parties', 'contact_id'],
    ['orders', 'sales_rep_id'], ['orders', 'title_officer_id'], ['orders', 'escrow_officer_id'],
    ['orders', 'lender_id'], ['orders', 'listing_agent_id'], ['orders', 'client_contact_id'],
  ];
  for (const [table, column] of refs) {
    const [r] = await sql.unsafe(`SELECT count(*)::int n FROM ${table} WHERE ${column} = ANY($1)`, [DUPLICATES]);
    if (r!.n > 0) throw new Error(`ABORT: ${table}.${column} references a duplicate (${r!.n} rows)`);
  }
  console.log('preflight OK: EriValEscr not held locally; duplicates and party row are as approved; no order references the duplicates');
}

await preflight();

if (!commit) {
  console.log('\nDRY RUN — would insert EriValEscr, link it to company 6250, deactivate #23074 and #23075, and set order_parties 38752.contact_id');
  await sql.end();
  process.exit(0);
}

const newId = await sql.begin(async (tx) => {
  const [created] = await tx<{ id: number }[]>`
    INSERT INTO contacts (
      source_system, source_id, type, first_name, last_name, full_name, company_name,
      email, phone, address1, city, roles,
      softpro_lookup_code, softpro_flookup_code, softpro_user_type, lookup_code, flookup_code, user_type,
      is_escrow, is_escrow_officer, is_active
    ) VALUES (
      'softpro', 'EriValEscr', 'person', 'Erika', 'Valencia', 'Valencia, Erika', 'Escrow360 Inc.',
      'erika@escrow360inc.com', '626-740-0188', '805 W. Duarte Road, Suite 108', 'Arcadia', ${['escrow']},
      'EriValEscr', 'Escr805W', 'escrow', 'EriValEscr', 'Escr805W', 'escrow',
      true, true, true
    ) RETURNING id`;
  const id = created!.id;

  await tx`INSERT INTO contact_company_links (contact_id, company_id, relationship_type)
           VALUES (${id}, ${COMPANY_ID}, 'employee')`;

  const deactivated = await tx`UPDATE contacts SET is_active = false, updated_at = now()
                               WHERE id = ANY(${DUPLICATES}) AND is_active = true`;
  if (deactivated.count !== 2) throw new Error(`expected to deactivate 2 duplicates, deactivated ${deactivated.count}`);

  const linked = await tx`UPDATE order_parties SET contact_id = ${id}
                          WHERE id = ${PARTY_ROW} AND contact_id IS NULL`;
  if (linked.count !== 1) throw new Error(`expected to link 1 party row, linked ${linked.count}`);

  await tx`INSERT INTO admin_activity_logs (user_id, action, entity_type, entity_id, meta) VALUES (
    'script:cleanup-erika-duplicates', 'contact_duplicates_collapsed', 'contact', ${String(id)},
    ${tx.json({
      kept_softpro_code: 'EriValEscr',
      new_contact_id: id,
      deactivated: [{ id: 23074, code: 'EriValEscr1' }, { id: 23075, code: 'EriValEscr2' }],
      order_party_linked: { order_parties_id: PARTY_ROW, order_id: ORDER_ID, file_number: '20022085-GLT' },
      approved_by: 'Gerard',
      reason: 'hub retry minted 11-character duplicates of a record SoftPro already held',
    })})`;
  return id;
});

console.log(`\nCOMMITTED. EriValEscr is contact #${newId}.`);
await sql.end();
process.exit(0);
