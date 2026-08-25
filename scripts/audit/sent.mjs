import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL, { max: 2, prepare: false });
const rows = await sql.unsafe(`
  select id, order_id, created_at, success, http_status,
         request_meta->'payload' as payload
  from vendor_api_logs
  where vendor='softpro' and operation='create_order'
  order by created_at desc limit 6`);
for (const r of rows) {
  const p = r.payload ?? {};
  const pd = (p.propertyDetails ?? [])[0] ?? {};
  const td = p.transactionDetails ?? {};
  const sd = p.sellerDetails ?? {};
  console.log('─'.repeat(80));
  console.log(`log ${r.id}  order ${r.order_id}  ${r.created_at.toISOString()}  success=${r.success}`);
  console.log(`  SENT propertyDetails[0]:`);
  for (const k of ['Address1','Address2','City','State','Zip','Country','APNNumberParcelID','Description']) {
    console.log(`     ${k.padEnd(20)} ${JSON.stringify(pd[k])}`);
  }
  console.log(`  SENT transactionDetails: PrimaryBorrower=${JSON.stringify([td.PrimaryBorrowerFirstName,td.PrimaryBorrowerMiddleName,td.PrimaryBorrowerLastName])}`);
  console.log(`     Secondary=${JSON.stringify([td.SecondaryBorrowerFirstName,td.SecondaryBorrowerMiddleName,td.SecondaryBorrowerLastName])}`);
  console.log(`     LookUpCodeTitleOffice=${JSON.stringify(td.LookUpCodeTitleOffice)}  TitleOffice=${JSON.stringify(td.TitleOffice)}`);
  console.log(`     Product=${JSON.stringify(td.Product)}  SalesAmount=${JSON.stringify(td.SalesAmount)}  LoanAmount=${JSON.stringify(td.LoanAmount)}`);
  console.log(`  SENT sellerDetails: ${JSON.stringify(sd)}`);
  console.log(`  SENT sections present: ${Object.keys(p).join(', ')}`);
}
await sql.end();
