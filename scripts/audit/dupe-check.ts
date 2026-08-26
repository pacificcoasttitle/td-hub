/**
 * READ-ONLY. Did either failed create actually produce an order?
 *
 * The first attempt at this searched GetOrders for the property address.
 * GetOrders returns ONLY {OrderNumber, OrderStatus, LastModifiedOn} — no
 * address — so that search returned "0 orders" for the two orders that
 * demonstrably exist. A negative result from a method that cannot find the
 * positives is worth nothing, so this uses two methods that can.
 */
import { getOrders, getOrderDetails } from '../../src/lib/integrations/softpro/client';

const day = new Date().toISOString().slice(0, 10);
const prev = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
const TARGET = '1434 N ELM ST';
const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '');

(async () => {
  const list = await getOrders({ dateFrom: prev, dateTo: day });
  const orders = (list.success && Array.isArray(list.data) ? list.data : []) as Record<string, string>[];

  // Method A — the two successful creates returned 20021376 and 20021378. If a
  // failed attempt had also created an order it would hold a later number in
  // the same sequence.
  const seq = orders
    .map((o) => String(o.OrderNumber))
    .filter((n) => /^200213[0-9]{2}-/.test(n))
    .sort();
  console.log('Order numbers in the 20021376+ neighbourhood, from GetOrders:');
  for (const n of seq.filter((n) => n >= '20021374')) {
    const o = orders.find((x) => x.OrderNumber === n)!;
    console.log(`   ${n}   ${o.OrderStatus}   modified ${o.LastModifiedOn}`);
  }

  // Method B — pull the DETAIL record for every order in the window and check
  // the address directly. This is the only way to see an address at all.
  console.log(`\nScanning detail records for "${TARGET}" across ${orders.length} orders in ${prev}..${day}`);
  let scanned = 0; let found = 0;
  for (const o of orders) {
    const d = await getOrderDetails({ dateFrom: prev, dateTo: day, orderNumber: String(o.OrderNumber) });
    const rec = (d.success && Array.isArray(d.data) ? d.data[0] : null) as Record<string, unknown> | null;
    if (!rec) continue;
    scanned++;
    const addr = String(rec.Address ?? '');
    if (norm(addr) === norm(TARGET) || norm(addr).includes(norm('1434'))) {
      found++;
      console.log(`   *** ${o.OrderNumber}  Address="${addr}"  City="${rec.City}"  received=${rec.ReceivedDate}`);
    }
  }
  console.log(`\n   detail records retrieved: ${scanned} of ${orders.length}`);
  console.log(`   orders carrying "${TARGET}": ${found}`);

  // Control: prove the scan can find an address we know is there.
  const ctl = await getOrderDetails({ dateFrom: prev, dateTo: day, orderNumber: '20021378-GLT' });
  const cr = (ctl.success && Array.isArray(ctl.data) ? ctl.data[0] : null) as Record<string, unknown> | null;
  console.log(`   CONTROL 20021378-GLT Address="${cr?.Address ?? '(none)'}" — the scan can read addresses: ${cr?.Address ? 'YES' : 'NO'}`);
  process.exit(0);
})();
