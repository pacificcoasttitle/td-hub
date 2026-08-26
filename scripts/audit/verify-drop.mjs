import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
console.log('ALL order_parties rows for the two orders, with is_primary:');
console.table(await sql.unsafe(`
  select o.file_number, pt.role, pt.is_primary, pt.external_name, pt.external_company
  from order_parties pt join orders o on o.id=pt.order_id
  where o.file_number in ('20019200-OCT','20020972-OCT')
  order by o.file_number, pt.role, pt.is_primary desc`));
await sql.end();
