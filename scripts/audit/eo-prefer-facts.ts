/**
 * READ-ONLY. Facts behind "prefer the internal officer row" for loadEscrowOfficers.
 *
 * Establishes, from the live database and nothing else:
 *   1. when the snapshot was taken (another agent is writing to these rows);
 *   2. what the current candidate set is (is_escrow_officer = true);
 *   3. which rows internalOfficerFilter('escrow_officer') selects;
 *   4. every contact that carries a duplicate of a PCT-internal officer;
 *   5. where each row is referenced (orders, order_parties, profiles, cc defaults);
 *   6. that no external officer is reclassified by the internal-row predicate.
 *
 *   npx tsx --env-file=.env.local scripts/audit/eo-prefer-facts.ts
 */
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });

type Row = Record<string, unknown>;

function table(rows: Row[], cols: [string, number][]): void {
  console.log('  ' + cols.map(([c, w]) => c.padEnd(w)).join(''));
  for (const r of rows) {
    console.log('  ' + cols.map(([c, w]) => String(r[c] ?? '(null)').slice(0, w - 1).padEnd(w)).join(''));
  }
}

(async () => {
  const [{ now }] = await sql.unsafe(`select now() at time zone 'utc' as now`) as unknown as Row[];
  console.log(`snapshot taken (db utc): ${now}`);
  console.log(`snapshot taken (local) : ${new Date().toString()}`);

  // ── 1. candidate sets ──────────────────────────────────────────────────────
  console.log('\n=== 1. candidate set sizes ===');
  const [sizes] = await sql.unsafe(`
    select
      (select count(*) from contacts where is_escrow_officer = true) as flag_true,
      (select count(*) from contacts
        where roles::jsonb @> '["escrow_officer"]'::jsonb
          and left(softpro_lookup_code, 4) = 'PCT\\'
          and office_lookup_code is not null and office_lookup_code <> ''
      ) as internal_filter,
      (select count(*) from contacts
        where is_escrow_officer = true
           or (roles::jsonb @> '["escrow_officer"]'::jsonb
               and left(softpro_lookup_code, 4) = 'PCT\\'
               and office_lookup_code is not null and office_lookup_code <> '')
      ) as union_set,
      (select count(*) from contacts
        where is_escrow_officer = true
          and (roles::jsonb @> '["escrow_officer"]'::jsonb
               and left(softpro_lookup_code, 4) = 'PCT\\'
               and office_lookup_code is not null and office_lookup_code <> '')
      ) as intersection,
      (select count(*) from contacts
        where is_escrow_officer = true
          and not (roles::jsonb @> '["escrow_officer"]'::jsonb
               and left(softpro_lookup_code, 4) = 'PCT\\'
               and office_lookup_code is not null and office_lookup_code <> '')
      ) as flag_only,
      (select count(*) from contacts
        where is_escrow_officer = false
          and (roles::jsonb @> '["escrow_officer"]'::jsonb
               and left(softpro_lookup_code, 4) = 'PCT\\'
               and office_lookup_code is not null and office_lookup_code <> '')
      ) as internal_only
  `) as unknown as Row[];
  for (const [k, v] of Object.entries(sizes)) console.log(`  ${k.padEnd(18)} ${v}`);

  // ── 2. every row internalOfficerFilter selects ─────────────────────────────
  console.log('\n=== 2. internalOfficerFilter(escrow_officer) rows ===');
  const internal = await sql.unsafe(`
    select id, full_name, officer_name, lookup_code, office_lookup_code,
           softpro_lookup_code, source_id, email, is_escrow_officer, type
      from contacts
     where roles::jsonb @> '["escrow_officer"]'::jsonb
       and left(softpro_lookup_code, 4) = 'PCT\\'
       and office_lookup_code is not null and office_lookup_code <> ''
     order by id
  `) as unknown as Row[];
  table(internal, [['id', 8], ['full_name', 24], ['lookup_code', 14], ['office_lookup_code', 8],
    ['softpro_lookup_code', 22], ['is_escrow_officer', 8], ['type', 10]]);

  // ── 3. every PCT\ contact, however flagged ─────────────────────────────────
  console.log('\n=== 3. every contact with a PCT\\ softpro_lookup_code ===');
  const pct = await sql.unsafe(`
    select id, full_name, officer_name, lookup_code, office_lookup_code,
           softpro_lookup_code, source_id, email, is_escrow_officer, is_title_officer,
           type, roles::text as roles
      from contacts
     where left(softpro_lookup_code, 4) = 'PCT\\'
     order by softpro_lookup_code, id
  `) as unknown as Row[];
  console.log(`  ${pct.length} row(s)`);
  table(pct, [['id', 8], ['full_name', 22], ['lookup_code', 13], ['office_lookup_code', 8],
    ['softpro_lookup_code', 20], ['is_escrow_officer', 6], ['is_title_officer', 6], ['roles', 40]]);

  // ── 4. the six named officers, both rows each, with references ─────────────
  console.log('\n=== 4. the six named officers: every row that could match, with references ===');
  const six = await sql.unsafe(`
    with target as (
      select distinct lower(coalesce(nullif(officer_name,''), full_name)) as nm
        from contacts
       where softpro_lookup_code in ('PCT\\aayala','PCT\\aballesteros','PCT\\cquintanar',
                                     'PCT\\jgomez','PCT\\kcasco','PCT\\lvidaca')
    )
    select c.id, c.full_name, c.officer_name, c.lookup_code, c.office_lookup_code,
           c.softpro_lookup_code, c.source_id, c.email, c.is_escrow_officer, c.type,
           (select count(*) from orders o where o.escrow_officer_id = c.id) as as_eo,
           (select count(*) from orders o where o.title_officer_id = c.id) as as_to,
           (select count(*) from order_parties p where p.contact_id = c.id) as as_party,
           (select count(*) from orders o where o.client_contact_id = c.id) as as_client,
           (select count(*) from profiles pr where pr.contact_id = c.id) as profiles,
           (select count(*) from officer_cc_defaults d where d.officer_contact_id = c.id) as cc_defaults
      from contacts c
     where lower(coalesce(nullif(c.officer_name,''), c.full_name)) in (select nm from target)
        or lower(c.full_name) in (select nm from target)
     order by lower(coalesce(c.officer_name, c.full_name)), c.id
  `) as unknown as Row[];
  table(six, [['id', 8], ['full_name', 20], ['officer_name', 20], ['lookup_code', 13],
    ['office_lookup_code', 8], ['softpro_lookup_code', 20], ['is_escrow_officer', 6],
    ['as_eo', 7], ['as_party', 8], ['as_client', 9], ['profiles', 9], ['cc_defaults', 6]]);

  // ── 5. duplicate source_id pairs among escrow candidates ───────────────────
  console.log('\n=== 5. contacts sharing a source_id with another contact (escrow candidates) ===');
  const dupes = await sql.unsafe(`
    select c.source_id, count(*) as n, string_agg(c.id::text, ',' order by c.id) as ids
      from contacts c
     where c.source_id is not null and c.source_id <> ''
     group by c.source_id
    having count(*) > 1
     order by c.source_id
  `) as unknown as Row[];
  console.log(`  ${dupes.length} duplicated source_id value(s)`);
  table(dupes, [['source_id', 30], ['n', 5], ['ids', 30]]);

  // ── 6. would any external be reclassified? ─────────────────────────────────
  console.log('\n=== 6. externals: is_escrow_officer=true rows that are NOT internal-officer rows ===');
  const [ext] = await sql.unsafe(`
    select
      count(*) as n,
      count(*) filter (where left(coalesce(softpro_lookup_code,''), 4) = 'PCT\\') as with_pct_code,
      count(*) filter (where office_lookup_code is not null and office_lookup_code <> '') as with_office,
      count(*) filter (where email ilike '%@pct.com') as with_pct_email
      from contacts
     where is_escrow_officer = true
       and not (roles::jsonb @> '["escrow_officer"]'::jsonb
                and left(softpro_lookup_code, 4) = 'PCT\\'
                and office_lookup_code is not null and office_lookup_code <> '')
  `) as unknown as Row[];
  for (const [k, v] of Object.entries(ext)) console.log(`  ${k.padEnd(18)} ${v}`);

  console.log('\n  top external escrow officers by order volume:');
  const topExt = await sql.unsafe(`
    select c.id, c.full_name, c.officer_name, c.softpro_lookup_code, c.office_lookup_code,
           count(o.id) as orders
      from contacts c join orders o on o.escrow_officer_id = c.id
     where c.is_escrow_officer = true
       and not (c.roles::jsonb @> '["escrow_officer"]'::jsonb
                and left(c.softpro_lookup_code, 4) = 'PCT\\'
                and c.office_lookup_code is not null and c.office_lookup_code <> '')
     group by c.id, c.full_name, c.officer_name, c.softpro_lookup_code, c.office_lookup_code
     order by count(o.id) desc
     limit 10
  `) as unknown as Row[];
  table(topExt, [['id', 8], ['full_name', 26], ['softpro_lookup_code', 22], ['office_lookup_code', 10], ['orders', 8]]);

  // ── 7. profiles of the internal officers ───────────────────────────────────
  console.log('\n=== 7. profiles linked to any internal officer name ===');
  const profs = await sql.unsafe(`
    select pr.id, pr.display_name, pr.email, pr.role, pr.contact_id, pr.is_active,
           c.full_name as contact_name, c.office_lookup_code, c.softpro_lookup_code,
           (select count(*) from orders o where o.escrow_officer_id = pr.contact_id) as orders_visible
      from profiles pr left join contacts c on c.id = pr.contact_id
     where pr.role = 'escrow_officer'
     order by pr.display_name
  `) as unknown as Row[];
  table(profs, [['display_name', 24], ['email', 30], ['contact_id', 11], ['contact_name', 22],
    ['office_lookup_code', 8], ['softpro_lookup_code', 20], ['orders_visible', 8], ['is_active', 6]]);

  await sql.end();
  process.exit(0);
})();
