import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL, { max: 2, prepare: false });
const q = async (l,t)=>{console.log('\n### '+l);console.table(await sql.unsafe(t));};
await q('order source distribution', `select source, count(*), min(opened_at)::date as first, max(opened_at)::date as last from orders group by 1 order by 2 desc`);
await q('lookup-code coverage on contacts used as officers', `
  select
    count(*) filter (where nullif(trim(softpro_lookup_code),'') is not null) as has_examiner_lookup,
    count(*) filter (where nullif(trim(lookup_code),'') is not null) as has_lookup_code,
    count(*) filter (where nullif(trim(flookup_code),'') is not null) as has_company_lookup,
    count(*) as total
  from contacts`);
await q('contacts that are title officers on orders — examiner lookup present?', `
  select count(distinct c.id) as officers_used,
         count(distinct c.id) filter (where nullif(trim(c.softpro_lookup_code),'') is not null) as with_examiner_lookup
  from orders o join contacts c on c.id = o.title_officer_id`);
await q('hub orders: local officer ids populated?', `
  select count(*) as hub_orders,
    count(*) filter (where sales_rep_id is not null) as has_sales_rep,
    count(*) filter (where title_officer_id is not null) as has_title_officer,
    count(*) filter (where escrow_officer_id is not null) as has_escrow_officer,
    count(*) filter (where client_contact_id is not null) as has_client
  from orders where source='manual_entry'`);
await q('local seller parties on refinances (should not exist)', `
  select count(*) as tbd_seller_rows
  from order_parties p join orders o on o.id=p.order_id
  where p.role='seller' and p.external_name = 'TBD TBD'`);
await sql.end();
