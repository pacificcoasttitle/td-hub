/**
 * READ-ONLY. The two Visalia 400s are unexplained. Four payload fields separate
 * the two that succeeded from the two that failed EXACTLY (both OK values
 * identical, both FAIL values identical, and the two groups differ).
 *
 * A field that discriminates on a sample of four proves nothing on its own, so
 * each candidate is tested against every create_order attempt ever logged: if a
 * value has never once succeeded, that is worth something; if it has succeeded
 * before, the hypothesis is dead.
 */
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });

const CANDIDATES: Array<{ label: string; path: string }> = [
  { label: 'baseDetails.OrderType', path: `request_meta->'payload'->'baseDetails'->>'OrderType'` },
  { label: 'personalDetails.UserType', path: `request_meta->'payload'->'personalDetails'->>'UserType'` },
  { label: 'personalDetails.SalesRep', path: `request_meta->'payload'->'personalDetails'->>'SalesRep'` },
  { label: 'txn.LookUpCodeTitleOffice', path: `request_meta->'payload'->'transactionDetails'->>'LookUpCodeTitleOffice'` },
  { label: 'txn.LookUpCodeEscrowOfficer', path: `request_meta->'payload'->'transactionDetails'->>'LookUpCodeEscrowOfficer'` },
  { label: 'txn.EscrowOfficerName', path: `request_meta->'payload'->'transactionDetails'->>'EscrowOfficerName'` },
  { label: 'txn.TransactionType', path: `request_meta->'payload'->'transactionDetails'->>'TransactionType'` },
  { label: 'txn.Product', path: `request_meta->'payload'->'transactionDetails'->>'Product'` },
];

(async () => {
  const [{ total, ok }] = await sql.unsafe(`
    select count(*)::int as total, count(*) filter (where success)::int as ok
    from vendor_api_logs where vendor='softpro' and operation='create_order'`);
  console.log(`create_order attempts ever logged: ${total}  (succeeded ${ok}, failed ${Number(total) - Number(ok)})\n`);

  for (const c of CANDIDATES) {
    console.log('─'.repeat(88));
    console.log(c.label);
    const rows = await sql.unsafe(`
      select coalesce(${c.path}, '(null/absent)') as value,
             count(*)::int as attempts,
             count(*) filter (where success)::int as succeeded,
             count(*) filter (where not success)::int as failed
      from vendor_api_logs
      where vendor='softpro' and operation='create_order'
      group by 1 order by failed desc, attempts desc`);
    for (const r of rows) {
      const verdict = r.succeeded > 0 && r.failed > 0 ? 'both'
        : r.succeeded > 0 ? 'always succeeded'
        : 'NEVER SUCCEEDED';
      console.log(`   ${String(r.value).slice(0, 34).padEnd(36)} attempts ${String(r.attempts).padStart(2)}  ok ${String(r.succeeded).padStart(2)}  fail ${String(r.failed).padStart(2)}   ${verdict}`);
    }
  }

  // Is OrangeCountyHouseAccount a lookup code we hold, and what shape are the others?
  console.log('\n' + '═'.repeat(88));
  console.log('SalesRep lookup shape — what does contacts hold for these?');
  const reps = await sql.unsafe(`
    select lookup_code, softpro_lookup_code, full_name, is_active
    from contacts
    where lookup_code in ('OrangeCountyHouseAccount')
       or softpro_lookup_code in ('OrangeCountyHouseAccount','PCT\\awu','PCT\\jnouri')
    limit 10`);
  console.table(reps);

  console.log('shape of sales-rep lookup codes actually used on orders:');
  console.table(await sql.unsafe(`
    select case when c.softpro_lookup_code like 'PCT\\%' then 'PCT\\ prefixed'
                when c.softpro_lookup_code is null or trim(c.softpro_lookup_code)='' then '(blank)'
                else 'other shape' end as shape,
           count(*)::int as contacts
    from contacts c where c.id in (select distinct sales_rep_id from orders where sales_rep_id is not null)
    group by 1 order by 2 desc`));

  // Has "Title & Escrow" ever been created successfully by ANY route?
  console.log('\norders in TD Hub by order_type and source:');
  console.table(await sql.unsafe(`
    select order_type, source, count(*)::int
    from orders where order_type is not null group by 1,2 order by 3 desc limit 12`));

  await sql.end();
  process.exit(0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
