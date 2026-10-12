/**
 * READ-ONLY. What columns distinguish the internal PCT officer rows from the
 * address-book duplicates, so the order-entry dropdown can select the right one.
 */
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });

(async () => {
  const rows = await sql.unsafe(`
    select id, full_name, officer_name, type, roles::text as roles,
           lookup_code, office_lookup_code, softpro_lookup_code, closer_examiner,
           softpro_user_type, source_system, source_id,
           is_title_officer, is_escrow_officer, is_active
      from contacts
     where left(softpro_lookup_code, 4) = 'PCT\\'
     order by is_title_officer desc, id
  `);
  console.log(`rows with a PCT\\ softpro_lookup_code: ${(rows as unknown[]).length}\n`);
  console.log(
    'id'.padEnd(7), 'name'.padEnd(22), 'TO'.padEnd(4), 'EO'.padEnd(4),
    'office'.padEnd(8), 'softpro_lookup'.padEnd(18), 'softpro_user_type'.padEnd(18),
    'roles'.padEnd(24), 'source_id',
  );
  console.log('-'.repeat(140));
  for (const r of rows as unknown as Record<string, unknown>[]) {
    console.log(
      String(r.id).padEnd(7),
      String(r.officer_name ?? r.full_name ?? '').slice(0, 21).padEnd(22),
      (r.is_title_officer ? 'yes' : '-').padEnd(4),
      (r.is_escrow_officer ? 'yes' : '-').padEnd(4),
      String(r.office_lookup_code ?? '(null)').padEnd(8),
      String(r.softpro_lookup_code ?? '').padEnd(18),
      String(r.softpro_user_type ?? '(null)').padEnd(18),
      String(r.roles ?? '(null)').slice(0, 23).padEnd(24),
      String(r.source_id ?? '(null)'),
    );
  }

  console.log('\n--- candidate escrow-officer predicates, row counts ---');
  const probes: Array<[string, string]> = [
    ['is_escrow_officer = true', `is_escrow_officer = true`],
    ['PCT\\ + office code', `left(softpro_lookup_code,4) = 'PCT\\' and office_lookup_code is not null and office_lookup_code <> ''`],
    ['... and softpro_user_type = escrow_officer', `left(softpro_lookup_code,4) = 'PCT\\' and office_lookup_code is not null and office_lookup_code <> '' and softpro_user_type = 'escrow_officer'`],
    ['... and not is_title_officer', `left(softpro_lookup_code,4) = 'PCT\\' and office_lookup_code is not null and office_lookup_code <> '' and is_title_officer = false`],
    ['... and roles has escrow_officer', `left(softpro_lookup_code,4) = 'PCT\\' and office_lookup_code is not null and office_lookup_code <> '' and roles::jsonb @> '["escrow_officer"]'::jsonb`],
  ];
  for (const [label, where] of probes) {
    const [c] = await sql.unsafe(`select count(*)::int as n from contacts where ${where}`) as unknown as Array<{ n: number }>;
    console.log(`  ${label.padEnd(46)} ${c!.n}`);
  }

  await sql.end();
  process.exit(0);
})();
