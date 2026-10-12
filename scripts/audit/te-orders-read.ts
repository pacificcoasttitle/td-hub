/**
 * READ-ONLY. Title & Escrow investigation, part 1: what does a T&E order that
 * EXISTS in SoftPro actually look like?
 *
 * Reads full detail on ten T&E orders across all four branches (four of them
 * PRV, the branch both August failures targeted) and prints every field, so the
 * shape of a working order can be diffed against the payloads we sent.
 */
import { getOrderDetails, getOrderContacts } from '../../src/lib/integrations/softpro/client';

const TARGETS = [
  { fileNumber: '20021474-OCT', opened: '2026-08-26' },
  { fileNumber: '20021466-OCT', opened: '2026-08-26' },
  { fileNumber: '20021381-GLT', opened: '2026-08-24' },
  { fileNumber: '20021364-GLT', opened: '2026-08-24' },
  { fileNumber: '20021330-ONT', opened: '2026-08-21' },
  { fileNumber: '20021273-ONT', opened: '2026-08-20' },
  { fileNumber: '20021428-PRV', opened: '2026-08-25' },
  { fileNumber: '20021320-PRV', opened: '2026-08-21' },
  { fileNumber: '20021309-PRV', opened: '2026-08-21' },
  { fileNumber: '20021227-PRV', opened: '2026-08-19' },
];

function window(opened: string): { dateFrom: string; dateTo: string } {
  const d = new Date(opened + 'T00:00:00Z');
  const from = new Date(d.getTime() - 3 * 86_400_000).toISOString().slice(0, 10);
  const to = new Date(d.getTime() + 3 * 86_400_000).toISOString().slice(0, 10);
  return { dateFrom: from, dateTo: to };
}

const HEADLINE = ['OrderNumber', 'OrderType', 'SettlementType', 'Branch', 'Office', 'TitleOffice', 'Examiner', 'TitleOfficer', 'EscrowOfficer', 'OwningProfile', 'ProductType', 'Product'];

(async () => {
  const collected: Record<string, Record<string, unknown>> = {};

  for (const t of TARGETS) {
    const { dateFrom, dateTo } = window(t.opened);
    const res = await getOrderDetails({ dateFrom, dateTo, orderNumber: t.fileNumber });
    if (!res.success) {
      console.log(`\n### ${t.fileNumber} — READ FAILED: ${res.error?.message}`);
      continue;
    }
    const rows = (Array.isArray(res.data) ? res.data : []) as unknown as Record<string, unknown>[];
    const rec = rows.find((r) => String(r.OrderNumber ?? '').trim() === t.fileNumber) ?? rows[0];
    if (!rec) {
      console.log(`\n### ${t.fileNumber} — no record returned (rows=${rows.length})`);
      continue;
    }
    collected[t.fileNumber] = rec;

    console.log(`\n${'='.repeat(100)}`);
    console.log(`### ${t.fileNumber}  (rows returned for window: ${rows.length})`);
    console.log('='.repeat(100));
    // Headline fields first, then everything else, so the answer is readable.
    for (const k of HEADLINE) {
      if (k in rec) console.log(`  ${k.padEnd(28)} ${JSON.stringify(rec[k])}`);
    }
    console.log('  --- all remaining fields ---');
    for (const [k, v] of Object.entries(rec)) {
      if (HEADLINE.includes(k)) continue;
      console.log(`  ${k.padEnd(28)} ${typeof v === 'object' ? JSON.stringify(v) : JSON.stringify(String(v))}`);
    }
  }

  // Which keys does every order carry, and which vary?
  const names = Object.keys(collected);
  if (names.length > 1) {
    const allKeys = new Set<string>();
    for (const rec of Object.values(collected)) Object.keys(rec).forEach((k) => allKeys.add(k));
    console.log(`\n${'='.repeat(100)}`);
    console.log('FIELD PRESENCE ACROSS THE ORDERS READ');
    console.log('='.repeat(100));
    for (const k of Array.from(allKeys).sort()) {
      const present = names.filter((n) => k in collected[n]!).length;
      const values = new Set(names.map((n) => JSON.stringify(collected[n]![k] ?? null)));
      const flag = present === names.length ? 'all' : `${present}/${names.length}`;
      console.log(`  ${k.padEnd(30)} present=${flag.padEnd(6)} distinct=${String(values.size).padEnd(3)} ${values.size <= 4 ? Array.from(values).join(' | ').slice(0, 90) : ''}`);
    }
  }

  // Contacts on one PRV order, since escrow party shape is what the failures carried.
  const probe = '20021428-PRV';
  const c = await getOrderContacts(probe);
  console.log(`\n${'='.repeat(100)}`);
  console.log(`GetOrderContacts ${probe}`);
  console.log('='.repeat(100));
  console.log(JSON.stringify(c.success ? c.data : c.error, null, 1));

  process.exit(0);
})();
