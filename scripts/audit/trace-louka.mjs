import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
console.log('-- what SiteX gave us for this property (order_properties.primary_owner) --');
console.table(await sql.unsafe(`
  select o.file_number, o.source, p.primary_owner, p.secondary_owner, p.address
  from orders o join order_properties p on p.order_id=o.id
  where o.file_number in ('20020972-OCT','20020970-OCT')`));
console.log('-- how many softpro_sync buyer/seller rows look SiteX-flipped (org suffix NOT at the end)? --');
console.table(await sql.unsafe(`
  select count(*)::int as org_named_parties,
    count(*) filter (where external_name ~* '(LLC|INC|CORP|TRUST)\s*$')::int as suffix_at_end_ok,
    count(*) filter (where external_name !~* '(LLC|INC|CORP|TRUST)\s*$')::int as suffix_mid_string
  from order_parties pt join orders o on o.id=pt.order_id
  where o.source='softpro_sync' and pt.role in ('buyer','seller')
    and external_name ~* '(LLC|INC|CORP|TRUST)'`));
await sql.end();
