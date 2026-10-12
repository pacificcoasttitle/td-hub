/**
 * READ-ONLY. Which `contacts` row did the two August Title & Escrow rejections
 * resolve as the escrow officer, and what would resolveBranchCode /
 * buildSoftProPayload read off it?
 */
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });

(async () => {
  const rows = await sql.unsafe(`
    select id, full_name, officer_name, first_name, last_name, type,
           lookup_code, flookup_code, office_lookup_code, softpro_lookup_code,
           closer_examiner, softpro_user_type, is_escrow_officer, is_title_officer, is_active
      from contacts
     where lower(full_name) like '%ballesteros%'
        or lower(officer_name) like '%ballesteros%'
        or softpro_lookup_code = 'PCT\\aballesteros'
        or lookup_code = 'AnnBalPaci'
     order by id
  `);
  for (const r of rows as unknown as Record<string, unknown>[]) {
    console.log('---');
    for (const [k, v] of Object.entries(r)) console.log(`  ${k.padEnd(20)} ${JSON.stringify(v)}`);
  }

  console.log('\n=== internal PCT escrow officers as the hub stores them ===');
  const internal = await sql.unsafe(`
    select id, full_name, officer_name, lookup_code, office_lookup_code, softpro_lookup_code, is_escrow_officer
      from contacts
     where softpro_lookup_code in ('PCT\\aayala','PCT\\aballesteros','PCT\\cquintanar','PCT\\jgomez','PCT\\kcasco','PCT\\lvidaca')
     order by softpro_lookup_code, id
  `);
  console.log('id'.padEnd(8), 'full_name'.padEnd(24), 'officer_name'.padEnd(24), 'lookup_code'.padEnd(14), 'office_lookup'.padEnd(14), 'softpro_lookup_code'.padEnd(20), 'is_eo');
  for (const r of internal as unknown as Record<string, unknown>[]) {
    console.log(
      String(r.id).padEnd(8),
      String(r.full_name ?? '').slice(0, 23).padEnd(24),
      String(r.officer_name ?? '').slice(0, 23).padEnd(24),
      String(r.lookup_code ?? '').padEnd(14),
      String(r.office_lookup_code ?? '(null)').padEnd(14),
      String(r.softpro_lookup_code ?? '').padEnd(20),
      String(r.is_escrow_officer),
    );
  }

  console.log('\n=== internal PCT title officers as the hub stores them ===');
  const tos = await sql.unsafe(`
    select id, full_name, officer_name, lookup_code, office_lookup_code, softpro_lookup_code, is_title_officer
      from contacts
     where is_title_officer = true
     order by id
  `);
  console.log('id'.padEnd(8), 'full_name'.padEnd(24), 'lookup_code'.padEnd(14), 'office_lookup'.padEnd(14), 'softpro_lookup_code');
  for (const r of tos as unknown as Record<string, unknown>[]) {
    console.log(
      String(r.id).padEnd(8),
      String(r.full_name ?? '').slice(0, 23).padEnd(24),
      String(r.lookup_code ?? '').padEnd(14),
      String(r.office_lookup_code ?? '(null)').padEnd(14),
      String(r.softpro_lookup_code ?? ''),
    );
  }

  await sql.end();
  process.exit(0);
})();
