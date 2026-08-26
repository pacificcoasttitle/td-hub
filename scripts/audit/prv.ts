/** READ-ONLY. Is PRV a valid SoftPro title-office code? */
import postgres from 'postgres';
import { getLookupTable } from '../../src/lib/integrations/softpro/client';
const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
(async () => {
  console.log('=== our branches table ===');
  console.table(await sql.unsafe(`select id, code, name, is_active from branches order by code`));
  console.log('=== branch codes actually seen on synced orders (via file number suffix) ===');
  console.table(await sql.unsafe(`
    select split_part(file_number,'-',2) as suffix, count(*)::int
    from orders where file_number like '%-%' group by 1 order by 2 desc limit 12`));
  console.log('=== OFFICER_BRANCH_MAP entry that produced PRV ===');
  console.table(await sql.unsafe(`
    select id, full_name, officer_name, lookup_code, office_lookup_code, softpro_lookup_code
    from contacts where lower(full_name) like '%ballesteros%' or lower(officer_name) like '%ballesteros%' limit 5`));
  for (const ut of ['TitleOffice','Office','Branch','EscrowCompany']) {
    const r = await getLookupTable(ut);
    const arr = (r.success && Array.isArray(r.data) ? r.data : []) as Record<string,string>[];
    console.log(`\nGetLookuptable("${ut}") success=${r.success} rows=${arr.length}` + (r.success ? '' : ` err=${JSON.stringify(r.error).slice(0,160)}`));
    if (arr.length) {
      console.log('  keys:', Object.keys(arr[0]!).join(', '));
      const hits = arr.filter(x => JSON.stringify(x).toUpperCase().includes('PRV'));
      console.log(`  rows mentioning PRV: ${hits.length}`, hits.slice(0,3).map(h=>JSON.stringify(h)).join(' | '));
      const glt = arr.filter(x => JSON.stringify(x).toUpperCase().includes('"GLT"') || JSON.stringify(x).toUpperCase().includes('GLT'));
      console.log(`  rows mentioning GLT: ${glt.length}`, glt.slice(0,2).map(h=>JSON.stringify(h)).join(' | '));
    }
  }
  await sql.end(); process.exit(0);
})();
