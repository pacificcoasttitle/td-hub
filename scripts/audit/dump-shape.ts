/**
 * READ-ONLY. Dumps the real key structure of GetOrderDetails / GetOrderContacts
 * so the comparison in readback.ts is checked against the actual contract
 * rather than against my guess at it.
 *
 * A field reported as "dropped" because the extractor looked in the wrong place
 * would be worse than not running the audit at all.
 */
import { getOrderDetails, getOrderContacts } from '../../src/lib/integrations/softpro/client';

const ORDER = process.argv[2];
const DAY = process.argv[3];

function walk(o: unknown, prefix = '', depth = 0, out: string[] = []): string[] {
  if (depth > 4 || o === null || o === undefined) return out;
  if (Array.isArray(o)) {
    out.push(`${prefix} :: array[${o.length}]`);
    if (o.length) walk(o[0], `${prefix}[0]`, depth + 1, out);
    return out;
  }
  if (typeof o !== 'object') {
    const v = String(o);
    out.push(`${prefix} = ${v.length > 60 ? v.slice(0, 60) + '…' : v}`);
    return out;
  }
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    walk(v, prefix ? `${prefix}.${k}` : k, depth + 1, out);
  }
  return out;
}

(async () => {
  console.log(`ORDER ${ORDER}   day ${DAY}\n`);

  const det = await getOrderDetails({ dateFrom: DAY, dateTo: DAY, orderNumber: ORDER });
  console.log('── GetOrderDetails ──────────────────────────────');
  console.log(`success=${det.success} ${det.success ? '' : JSON.stringify(det.error)}`);
  if (det.success) {
    const arr = det.data as unknown[];
    console.log(`records: ${Array.isArray(arr) ? arr.length : 'not an array'}`);
    for (const line of walk(Array.isArray(arr) ? arr[0] : arr)) console.log('  ' + line);
  }

  const con = await getOrderContacts(ORDER!);
  console.log('\n── GetOrderContacts ─────────────────────────────');
  console.log(`success=${con.success} ${con.success ? '' : JSON.stringify(con.error)}`);
  if (con.success) for (const line of walk(con.data)) console.log('  ' + line);

  process.exit(0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
