import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
console.log('--- sitex operations logged ---');
console.table(await sql.unsafe(`select operation, count(*)::int as n, max(created_at)::date as last
  from vendor_api_logs where vendor='sitex' group by 1 order by 2 desc`));
console.log('--- distinct response_meta KEY SETS for property_lookup ---');
console.table(await sql.unsafe(`
  select keys, count(*)::int as n from (
    select (select string_agg(k,',' order by k) from jsonb_object_keys(response_meta) k) as keys
    from vendor_api_logs where vendor='sitex' and operation='property_lookup' and response_meta is not null
  ) t group by 1 order by 2 desc limit 10`));
console.log('--- any sitex log row mentioning "owner" at all? ---');
console.table(await sql.unsafe(`
  select count(*)::int as rows_mentioning_owner from vendor_api_logs
  where vendor='sitex' and (response_meta::text ilike '%owner%' or request_meta::text ilike '%owner%')`));
await sql.end();
