import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
console.log('TransactionType values we have SENT to createOrder:');
console.table(await sql.unsafe(`
  select request_meta->'payload'->'transactionDetails'->>'TransactionType' as sent,
         count(*)::int as n,
         bool_and(request_meta->'payload'->'transactionDetails'->>'TransactionType'
                  in ('Purchase','Refinance','Equity')) as exact_case_adapter_accepts
  from vendor_api_logs where vendor='softpro' and operation='create_order' group by 1 order by 2 desc`));
console.log("orders whose transaction_type is 'Other', by source:");
console.table(await sql.unsafe(`
  select coalesce(transaction_type::text,'(null)') as tx, source, count(*)::int
  from orders group by 1,2 order by 3 desc limit 12`));
await sql.end();
