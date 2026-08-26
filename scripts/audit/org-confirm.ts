/** READ-ONLY. Two confirmations: is buyer.Company real-but-unused, and who mangles the name. */
import postgres from 'postgres';
import { getOrderContacts } from '../../src/lib/integrations/softpro/client';
const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
(async () => {
  const rows = await sql.unsafe(`
    select o.file_number, pt.role, pt.external_name
    from order_parties pt join orders o on o.id=pt.order_id
    where o.file_number in ('20020899-GLT','20020972-OCT','20020001-OCT','20019200-OCT','20021009-GLT','20020186-GLT')
      and pt.role in ('buyer','seller') order by o.file_number`);
  const ours = new Map(rows.map(r => [`${r.file_number}|${r.role}`, String(r.external_name)]));

  console.log('1) DOES A Company SUB-OBJECT EXIST, AND IS IT EVER USED FOR AN LLC?\n');
  for (const fn of ['20020899-GLT','20020972-OCT','20020001-OCT','20019200-OCT']) {
    const r = await getOrderContacts(fn);
    if (!r.success) { console.log(`${fn} FAILED`); continue; }
    const c = r.data as Record<string, any>;
    console.log(`${fn}`);
    console.log(`   buyer (full, nulls included) = ${JSON.stringify(c.buyer)}`);
  }

  console.log('\n2) WHO MANGLES THE ORG NAME — SoftPro, or our sync?\n');
  console.log(`   ${'order'.padEnd(15)} ${'SoftPro holds'.padEnd(44)} we stored`);
  for (const fn of ['20020899-GLT','20020972-OCT','20020001-OCT','20019200-OCT','20021009-GLT','20020186-GLT']) {
    const r = await getOrderContacts(fn);
    if (!r.success) continue;
    const c = r.data as Record<string, any>;
    const sp = c.buyer?.Person?.PrimaryBorrower ?? c.Sellers?.PrimarySeller ?? '';
    const role = c.buyer?.Person?.PrimaryBorrower ? 'buyer' : 'seller';
    const mine = ours.get(`${fn}|${role}`) ?? '(none)';
    const same = String(sp).toLowerCase().replace(/[^a-z0-9]/g,'') === mine.toLowerCase().replace(/[^a-z0-9]/g,'');
    console.log(`   ${fn.padEnd(15)} ${String(sp).slice(0,42).padEnd(44)} ${mine.slice(0,42)}${same?'':'   <-- DIFFERS'}`);
  }
  await sql.end(); process.exit(0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
