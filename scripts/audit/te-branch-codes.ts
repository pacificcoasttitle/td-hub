/**
 * READ-ONLY. Title & Escrow investigation, part 3: is 'PRV' a valid title office
 * lookup code at all?
 *
 * GetOrderDetails carries no branch field, so the only authoritative read of an
 * order's title office is GetOrderContacts -> TitleCompanies.Company.LookupCode.
 * Reads one order per branch per order type and reports what SoftPro itself has
 * on the order, next to the codes buildSoftProPayload would have sent.
 */
import { getOrderContacts } from '../../src/lib/integrations/softpro/client';

const TARGETS = [
  { fileNumber: '20021488-OCT', type: 'Title only' },
  { fileNumber: '20021474-OCT', type: 'Title & Escrow' },
  { fileNumber: '20021485-GLT', type: 'Title only' },
  { fileNumber: '20021381-GLT', type: 'Title & Escrow' },
  { fileNumber: '20021330-ONT', type: 'Title & Escrow' },
  { fileNumber: '20015310-PRV', type: 'Title only' },
  { fileNumber: '20021428-PRV', type: 'Title & Escrow' },
  { fileNumber: '20021320-PRV', type: 'Title & Escrow' },
  { fileNumber: '20021309-PRV', type: 'Title & Escrow' },
  { fileNumber: '20021227-PRV', type: 'Title & Escrow' },
];

interface Party {
  Company?: { LookupCode?: string; Name?: string; City?: string } | null;
  Person?: { LookupCode?: string; Name?: string } | null;
}

(async () => {
  console.log('file'.padEnd(16), 'order type'.padEnd(16), 'TitleCo code'.padEnd(14), 'TitleCo city'.padEnd(14), 'EscrowCo code'.padEnd(14), 'Escrow person'.padEnd(14));
  console.log('-'.repeat(105));

  const titleCodes = new Map<string, number>();
  for (const t of TARGETS) {
    const res = await getOrderContacts(t.fileNumber);
    if (!res.success) {
      console.log(`${t.fileNumber.padEnd(16)} ${t.type.padEnd(16)} READ FAILED ${res.error?.message}`);
      continue;
    }
    const d = res.data as unknown as Record<string, Party | null>;
    const tc = d.TitleCompanies?.Company ?? null;
    const ec = d.EscrowCompanies?.Company ?? null;
    const ep = d.EscrowCompanies?.Person ?? null;
    const code = (tc?.LookupCode ?? '').trim() || '(none)';
    titleCodes.set(code, (titleCodes.get(code) ?? 0) + 1);
    console.log(
      t.fileNumber.padEnd(16),
      t.type.padEnd(16),
      code.padEnd(14),
      (tc?.City ?? '').padEnd(14),
      ((ec?.LookupCode ?? '') || '(none)').padEnd(14),
      ((ep?.LookupCode ?? '') || '(none)').padEnd(14),
    );
  }

  console.log('\nTitleCompanies.Company.LookupCode values observed on real orders:');
  for (const [code, n] of Array.from(titleCodes).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${code.padEnd(12)} ${n} order(s)`);
  }
  process.exit(0);
})();
