import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
console.table(await sql.unsafe(`
  select o.id, o.file_number, o.source, o.opened_at, o.operational_status
  from orders o join order_properties p on p.order_id=o.id
  where p.address ilike '%1434 N ELM%'`));
console.log('local orders whose file_number never appeared in a successful create_order response:');
console.table(await sql.unsafe(`
  select count(*) as manual_entry_orders,
         count(*) filter (where exists (
           select 1 from vendor_api_logs v where v.vendor='softpro' and v.operation='create_order'
             and v.success and v.response_meta->>'orderNumber' = o.file_number)) as traceable_to_a_successful_create
  from orders o where o.source='manual_entry'`));
await sql.end();
