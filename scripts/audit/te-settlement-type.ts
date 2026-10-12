/**
 * READ-ONLY. Title & Escrow investigation, part 4: test the SettlementType
 * hypothesis against production.
 *
 * The hypothesis is that an OrderType -> SettlementType mapping turns
 * "Title only" into CSS and is what rejects "Title & Escrow". SettlementType
 * appears nowhere in this repo — we never send it — so the only way to test the
 * mapping is to read what SoftPro itself stores on real orders of each type.
 */
import { getOrderDetails } from '../../src/lib/integrations/softpro/client';

const TARGETS = [
  { fileNumber: '20021488-OCT', expected: 'Title only', opened: '2026-08-26' },
  { fileNumber: '20021487-OCT', expected: 'Title only', opened: '2026-08-26' },
  { fileNumber: '20021486-OCT', expected: 'Title only', opened: '2026-08-26' },
  { fileNumber: '20021474-OCT', expected: 'Title & Escrow', opened: '2026-08-26' },
  { fileNumber: '20021428-PRV', expected: 'Title & Escrow', opened: '2026-08-25' },
  { fileNumber: '20020700-ONT', expected: 'Escrow only', opened: '2026-08-05' },
  { fileNumber: '20020639-ONT', expected: 'Escrow only', opened: '2026-08-04' },
  { fileNumber: '99101046', expected: 'Trustee Sale Guarantee', opened: '2026-08-24' },
  { fileNumber: '99101044', expected: 'Trustee Sale Guarantee', opened: '2026-08-21' },
];

(async () => {
  console.log('file'.padEnd(16), 'db order_type'.padEnd(24), 'SoftPro OrderType'.padEnd(24), 'SettlementType'.padEnd(16), 'ProductType');
  console.log('-'.repeat(110));

  const pairs = new Map<string, Set<string>>();
  for (const t of TARGETS) {
    const d = new Date(t.opened + 'T00:00:00Z');
    const res = await getOrderDetails({
      dateFrom: new Date(d.getTime() - 3 * 86_400_000).toISOString().slice(0, 10),
      dateTo: new Date(d.getTime() + 3 * 86_400_000).toISOString().slice(0, 10),
      orderNumber: t.fileNumber,
    });
    const rows = (Array.isArray(res.data) ? res.data : []) as unknown as Record<string, unknown>[];
    const rec = rows.find((r) => String(r.OrderNumber ?? '').trim() === t.fileNumber) ?? rows[0];
    if (!res.success || !rec) {
      console.log(t.fileNumber.padEnd(16), t.expected.padEnd(24), '(no record returned)');
      continue;
    }
    const ot = String(rec.OrderType ?? '');
    const st = String(rec.SettlementType ?? '');
    if (!pairs.has(ot)) pairs.set(ot, new Set());
    pairs.get(ot)!.add(st);
    console.log(
      t.fileNumber.padEnd(16),
      t.expected.padEnd(24),
      ot.padEnd(24),
      st.padEnd(16),
      String(rec.ProductType ?? ''),
    );
  }

  console.log('\nOrderType -> SettlementType as SoftPro actually stores it:');
  for (const [ot, sts] of pairs) {
    console.log(`  ${ot.padEnd(26)} -> ${Array.from(sts).join(', ')}`);
  }
  process.exit(0);
})();
