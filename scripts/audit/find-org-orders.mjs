import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
const ORG = "(pt.external_name ilike '%LLC%' or pt.external_name ilike '%TRUST%' or pt.external_name ilike '% INC%' or pt.external_name ilike '%CORP%' or pt.external_company ilike '%LLC%')";
console.log('-- order_parties on SoftPro-synced orders whose name looks like an org --');
console.table(await sql.unsafe(`
  select pt.role, count(*)::int as n
  from order_parties pt join orders o on o.id=pt.order_id
  where o.source='softpro_sync' and ${ORG} group by 1 order by 2 desc`));
console.log('\n-- candidates to read back (buyer/seller org names, recent) --');
console.table(await sql.unsafe(`
  select o.file_number, o.opened_at::date as opened, pt.role,
         left(pt.external_name,44) as external_name, left(coalesce(pt.external_company,''),28) as external_company
  from order_parties pt join orders o on o.id=pt.order_id
  where o.source='softpro_sync' and ${ORG} and pt.role in ('buyer','seller')
  order by o.opened_at desc limit 14`));
console.log('\n-- how does the sync store an org? any party with company but no name? --');
console.table(await sql.unsafe(`
  select count(*)::int as total,
    count(*) filter (where nullif(trim(external_name),'') is null and nullif(trim(external_company),'') is not null)::int as company_only,
    count(*) filter (where nullif(trim(external_name),'') is not null and nullif(trim(external_company),'') is not null)::int as both
  from order_parties pt join orders o on o.id=pt.order_id
  where o.source='softpro_sync' and pt.role in ('buyer','seller')`));
await sql.end();
