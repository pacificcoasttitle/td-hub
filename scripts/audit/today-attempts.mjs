import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL, { max: 2, prepare: false });
// Pacific calendar day, computed in SQL so there is no server-local ambiguity.
const rows = await sql.unsafe(`
  with pac as (select ((date_trunc('day', now() at time zone 'America/Los_Angeles')) at time zone 'America/Los_Angeles') at time zone 'UTC' as t0)
  select v.id, v.created_at, v.started_at, v.ended_at, v.success, v.http_status,
         v.error_category, v.order_id,
         v.response_meta, v.request_meta
  from vendor_api_logs v, pac
  where v.vendor='softpro' and v.operation='create_order' and v.created_at >= pac.t0
  order by v.created_at asc`);
console.log(`create_order attempts today (Pacific): ${rows.length}\n`);
for (const r of rows) {
  console.log('#'.repeat(100));
  console.log(`log ${r.id}   ${r.created_at.toISOString()}   success=${r.success}  http=${r.http_status}  order_id=${r.order_id}`);
  console.log('--- RESPONSE (verbatim) ---');
  console.log(JSON.stringify(r.response_meta, null, 1));
  console.log('--- REQUEST PAYLOAD (verbatim) ---');
  console.log(JSON.stringify(r.request_meta?.payload ?? r.request_meta, null, 1));
}
await sql.end();
