import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL, { max: 2, prepare: false });
console.log('=== today\'s failed creates ===');
for (const r of await sql.unsafe(`
  select id, created_at, http_status, error_category, response_meta
  from vendor_api_logs where vendor='softpro' and operation='create_order' and success=false
  order by created_at desc limit 5`)) {
  console.log(`${r.created_at.toISOString()}  http=${r.http_status} cat=${r.error_category}`);
  console.log('   ' + JSON.stringify(r.response_meta).slice(0, 600));
}
console.log('\n=== contact sections ever sent, across all create_order calls ===');
console.table(await sql.unsafe(`
  select count(*) as total_creates,
    count(*) filter (where request_meta->'payload' ? 'buyersAgentDetails') as buyers_agent,
    count(*) filter (where request_meta->'payload' ? 'listingAgentDetails') as listing_agent,
    count(*) filter (where request_meta->'payload' ? 'lenderDetails') as lender,
    count(*) filter (where request_meta->'payload' ? 'escrowDetails') as escrow,
    count(*) filter (where request_meta->'payload' ? 'mortgageDetails') as mortgage_broker
  from vendor_api_logs where vendor='softpro' and operation='create_order'`));
console.log('\n=== how often TitleOffice examiner was omitted ===');
console.table(await sql.unsafe(`
  select count(*) as creates,
    count(*) filter (where not (request_meta->'payload'->'transactionDetails' ? 'TitleOffice')) as examiner_omitted,
    count(*) filter (where coalesce(request_meta->'payload'->'personalDetails'->>'ClientLookupCode','')='') as client_lookup_blank,
    count(*) filter (where coalesce(request_meta->'payload'->'personalDetails'->>'SalesRep','')='') as salesrep_blank
  from vendor_api_logs where vendor='softpro' and operation='create_order'`));
await sql.end();
