/**
 * READ-ONLY. Should "prepared for" autocomplete from contacts, or from a new
 * store of its own?
 *
 * The instruction is to store prepared-for name and company on every generate
 * so the field can autocomplete. Before adding a second store of client names
 * beside a contacts table that already has a known duplicate problem, this
 * asks whether the people are already in there.
 *
 * Two numbers decide it:
 *   1. How many prepared-for names on existing profiles match a contact.
 *   2. How bad the duplicate problem is, because a picker that offers the same
 *      person three times is the indistinguishable-twins defect already
 *      ticketed on the rep picker.
 *
 * NO WRITES AND NO VENDOR CALLS.
 */
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, { max: 2, prepare: false });

/** The same shape a picker would have to match on. */
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

(async () => {
  const profiles = await sql`
    SELECT id, prepared_for_name, prepared_for_company, prepared_for_email
    FROM concierge_profiles
    WHERE coalesce(trim(prepared_for_name), '') <> ''
    ORDER BY id`;

  console.log(`\nProfiles with a prepared-for name: ${profiles.length}\n`);

  const [{ total }] = await sql`SELECT count(*)::int AS total FROM contacts`;
  console.log(`contacts rows: ${total}`);

  // How many distinct people, and how many share an email?
  const dupes = await sql`
    SELECT count(*)::int AS emails_on_more_than_one_row
    FROM (
      SELECT lower(trim(email)) AS e
      FROM contacts
      WHERE coalesce(trim(email), '') <> ''
      GROUP BY 1 HAVING count(*) > 1
    ) d`;
  console.log(`email addresses appearing on more than one contact row: ${dupes[0].emails_on_more_than_one_row}`);

  const rowsForDupes = await sql`
    SELECT coalesce(sum(n) - count(*), 0)::int AS surplus
    FROM (
      SELECT count(*)::int AS n FROM contacts
      WHERE coalesce(trim(email), '') <> ''
      GROUP BY lower(trim(email)) HAVING count(*) > 1
    ) d`;
  console.log(`  ...accounting for ${rowsForDupes[0].surplus} surplus rows a picker could offer as separate people`);

  console.log('\n── does each prepared-for person already exist in contacts? ──\n');
  let matched = 0;
  let ambiguous = 0;
  for (const p of profiles) {
    const name = String(p.prepared_for_name);
    const hits = await sql`
      SELECT id, full_name, email, company_name
      FROM contacts
      WHERE lower(regexp_replace(coalesce(full_name, ''), '[^a-zA-Z0-9]+', ' ', 'g')) = ${norm(name)}
      LIMIT 5`;
    if (hits.length > 0) matched += 1;
    if (hits.length > 1) ambiguous += 1;
    console.log(`  profile ${String(p.id).padEnd(4)} ${name.padEnd(26)} ${hits.length} contact match(es)${hits.length > 1 ? '  <- AMBIGUOUS' : ''}`);
    for (const h of hits) {
      console.log(`      #${h.id} ${String(h.full_name ?? '—').padEnd(26)} ${String(h.email ?? '—').padEnd(30)} ${h.company_name ?? ''}`);
    }
  }

  console.log(`\n  matched: ${matched} of ${profiles.length}   ambiguous: ${ambiguous}`);
  console.log();
  if (profiles.length === 0) {
    console.log('  No prepared-for names recorded yet, so there is nothing to match');
    console.log('  and nothing to autocomplete from. Storing them is the prerequisite.');
  } else if (matched === 0) {
    console.log('  NONE of them are contacts. Autocompleting from contacts would offer');
    console.log('  the operator a list that never contains who they are typing.');
  } else if (matched < profiles.length) {
    console.log('  PARTIAL. Some are contacts and some are not, so a contacts-only');
    console.log('  picker would silently omit the rest — worse than no picker, because');
    console.log('  an absent name reads as "not in the system" rather than "not indexed".');
  } else {
    console.log('  All of them are contacts. Autocomplete from contacts, and dedupe.');
  }

  await sql.end();
})().catch((e) => { console.error('FAILED:', String(e).slice(0, 400)); process.exit(1); });
