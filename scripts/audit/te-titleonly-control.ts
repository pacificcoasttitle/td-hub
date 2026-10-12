/**
 * READ-ONLY, against production reads only (GetOrderDetails). No writes.
 *
 * The Title only order created on staging came back with EscrowOfficer
 * "PCT\rsupport" even though LookUpCodeEscrowOfficer was null. This checks a
 * real Title only order the hub created BEFORE the fix — same null escrow code,
 * but EscrowOfficerName null instead of "" — to see whether SoftPro fills in the
 * same default there too. If it does, the default is SoftPro's behaviour for an
 * unassigned escrow officer and not something the empty name introduced.
 */
import postgres from 'postgres';

(async () => {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  const ops = await sql.unsafe(`
    select operation, count(*)::int as n, sum(case when success then 1 else 0 end)::int as ok
      from vendor_api_logs
     where vendor = 'softpro' and created_at > now() - interval '60 days'
     group by operation order by n desc limit 10
  `) as unknown as Array<Record<string, unknown>>;
  console.log('--- softpro operations logged in the last 60 days ---');
  for (const o of ops) console.log(`  ${String(o.operation).padEnd(24)} n=${o.n} ok=${o.ok}`);

  const shape = await sql.unsafe(`
    select id, operation, success, response_meta::text as rm
      from vendor_api_logs
     where operation ilike '%reate%rder%' and success = true
     order by created_at desc limit 2
  `) as unknown as Array<Record<string, unknown>>;
  console.log('\n--- response_meta shape on a successful create ---');
  for (const s of shape) console.log(`  id=${s.id} op=${s.operation} ${String(s.rm).slice(0, 300)}`);

  const rows = await sql.unsafe(`
    select response_meta->>'orderNumber' as order_number,
           request_meta->'payload'->'baseDetails'->>'OrderType' as order_type,
           request_meta->'payload'->'transactionDetails'->>'LookUpCodeEscrowOfficer' as escrow_code,
           request_meta->'payload'->'transactionDetails'->>'EscrowOfficerName' as escrow_name,
           created_at
      from vendor_api_logs
     where operation = 'create_order'
       and success = true
       and request_meta->'payload'->'baseDetails'->>'OrderType' = 'Title only'
     order by created_at desc
     limit 3
  `) as unknown as Array<Record<string, unknown>>;
  await sql.end();

  console.log('--- recent successful Title only createOrder calls (production) ---');
  for (const r of rows) {
    console.log(`  ${String(r.order_number).padEnd(20)} escrowCode=${JSON.stringify(r.escrow_code)} escrowName=${JSON.stringify(r.escrow_name)} ${String(r.created_at).slice(0, 19)}`);
  }
  if (rows.length === 0) {
    console.log('  (none found)');
    process.exit(0);
  }

  const target = String(rows[0]!.order_number);
  const { getOrderDetails } = await import('../../src/lib/integrations/softpro/client');
  console.log(`\n--- production GetOrderDetails for ${target} (read-only) ---`);
  console.log(`  base URL: ${process.env.SOFTPRO_API_URL}`);

  const day = String(rows[0]!.created_at).slice(0, 10);
  const det = await getOrderDetails({ dateFrom: day, dateTo: day, orderNumber: target });
  const list = (Array.isArray(det.data) ? det.data : []) as unknown as Record<string, unknown>[];
  const rec = list.find((r) => String(r.OrderNumber ?? '').trim() === target) ?? list[0];
  if (!rec) {
    console.log(`  (no record; success=${det.success}, err=${det.error?.message ?? 'none'})`);
    process.exit(0);
  }
  for (const k of ['OrderNumber', 'OrderType', 'TitleOfficer', 'EscrowOfficer', 'EscrowOfficerContact', 'TitleOfficerContact']) {
    console.log(`  ${k.padEnd(22)} ${JSON.stringify(rec[k])}`);
  }
  process.exit(0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
