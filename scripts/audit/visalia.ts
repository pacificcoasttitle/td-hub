/** READ-ONLY. What is 20021382-OCT, and does it correspond to our failed payload? */
import postgres from 'postgres';
import { getOrderDetails, getOrderContacts } from '../../src/lib/integrations/softpro/client';
const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
const day = new Date().toISOString().slice(0,10);
const prev = new Date(Date.now()-86400000).toISOString().slice(0,10);
(async () => {
  const d = await getOrderDetails({ dateFrom: prev, dateTo: day, orderNumber: '20021382-OCT' });
  const rec = (d.success && Array.isArray(d.data) ? d.data[0] : null) as Record<string, unknown> | null;
  console.log('=== GetOrderDetails 20021382-OCT ===');
  for (const [k,v] of Object.entries(rec ?? {})) {
    console.log(`  ${k.padEnd(24)} ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
  }
  const c = await getOrderContacts('20021382-OCT');
  console.log('\n=== GetOrderContacts 20021382-OCT ===');
  console.log(JSON.stringify(c.data, null, 1));

  console.log('\n=== is it in the TD Hub database? ===');
  console.table(await sql.unsafe(`
    select id, file_number, source, opened_at, created_by, operational_status
    from orders where file_number = '20021382-OCT'`));

  console.log('\n=== every create_order attempt whose payload mentions this address ===');
  console.table(await sql.unsafe(`
    select id, created_at, success, response_meta->>'orderNumber' as order_number
    from vendor_api_logs
    where vendor='softpro' and operation='create_order'
      and request_meta::text ilike '%1434 N ELM%'
    order by created_at`));

  console.log('\n=== any OTHER softpro write op today that could have created it ===');
  console.table(await sql.unsafe(`
    with pac as (select ((date_trunc('day', now() at time zone 'America/Los_Angeles')) at time zone 'America/Los_Angeles') at time zone 'UTC' as t0)
    select operation, count(*), count(*) filter (where success) as ok
    from vendor_api_logs v, pac
    where v.vendor='softpro' and v.created_at >= pac.t0
      and v.operation not in ('get_orders','get_order_details','get_order_contacts','get_attached_documents','get_lookup_table')
    group by 1 order by 2 desc`));
  await sql.end();
  process.exit(0);
})();
