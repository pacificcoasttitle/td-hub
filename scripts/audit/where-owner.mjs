import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
console.log('--- which key set carries "owner" ---');
console.table(await sql.unsafe(`
  select keys, count(*)::int as n from (
    select (select string_agg(k,',' order by k) from jsonb_object_keys(response_meta) k) as keys
    from vendor_api_logs where vendor='sitex' and operation='property_lookup'
      and response_meta::text ilike '%owner%'
  ) t group by 1 order by 2 desc`));
console.log('\n--- a multi-match candidate, verbatim ---');
const [m] = await sql.unsafe(`
  select response_meta->'candidates'->0 as c from vendor_api_logs
  where vendor='sitex' and operation='property_lookup'
    and response_meta ? 'candidates' and response_meta::text ilike '%owner%' limit 1`);
console.log(JSON.stringify(m?.c, null, 1));
console.log('\n--- an error body mentioning owner, first 400 chars ---');
const [e] = await sql.unsafe(`
  select left(response_meta->>'body', 400) as b from vendor_api_logs
  where vendor='sitex' and operation='property_lookup'
    and response_meta ? 'body' and response_meta->>'body' ilike '%owner%' limit 1`);
console.log(e?.b ?? '(none)');
await sql.end();
