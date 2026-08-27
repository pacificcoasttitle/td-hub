/**
 * READ-ONLY. The sales-rep loader is the only other candidate set with two rows
 * answering to one name (Kevin Cameron, contacts 8 and 22265). The resolvers
 * gained a lowest-id tie-break; this checks whether that changes which row the
 * live data already points at, or only makes today's accident repeatable.
 *
 *   npx tsx --env-file=.env.local scripts/audit/eo-prefer-salesrep-tiebreak.ts
 */
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });

(async () => {
  const rows = await sql.unsafe(`
    select c.id, c.full_name, c.officer_name, c.first_name, c.last_name,
           c.lookup_code, c.softpro_lookup_code, c.is_sales_rep, c.is_title_officer,
           (select count(*) from orders o where o.sales_rep_id = c.id)::int as as_sales_rep
      from contacts c
     where c.is_sales_rep = true
       and lower(coalesce(nullif(c.officer_name,''), c.full_name)) in (
             select lower(coalesce(nullif(officer_name,''), full_name))
               from contacts where is_sales_rep = true
                and coalesce(nullif(officer_name,''), full_name) is not null
              group by 1 having count(*) > 1)
     order by c.id
  `) as unknown as Record<string, unknown>[];

  for (const r of rows) {
    console.log('---');
    for (const [k, v] of Object.entries(r)) console.log(`  ${k.padEnd(20)} ${JSON.stringify(v)}`);
  }

  console.log('\nunordered scan order postgres actually returns for the sales-rep loader:');
  const scan = await sql.unsafe(`
    select id, full_name from contacts where is_sales_rep = true
  `) as unknown as Record<string, unknown>[];
  const idx8 = scan.findIndex((r) => r.id === 8);
  const idx2 = scan.findIndex((r) => r.id === 22265);
  console.log(`  contact 8 at position ${idx8}, contact 22265 at position ${idx2}`
    + ` -> first-wins picks ${idx8 >= 0 && (idx2 < 0 || idx8 < idx2) ? 8 : 22265}`);

  await sql.end();
  process.exit(0);
})();
