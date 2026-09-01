import { config } from 'dotenv';
import { getLookupTable } from '../../src/lib/integrations/softpro/client';

config({ path: 'C:/Users/gerar/Desktop/TransactionDeskV2/td-hub/.env.local', override: true });
process.env.SOFTPRO_API_URL = 'http://100.29.181.61:8081/api/';

const WANT = 'StaProhxqq';

function codeOf(item: Record<string, string>): string {
  return (item['Lookup Code'] ?? item.LookupCode ?? item.lookup_code ?? '').trim();
}

(async () => {
  for (const t of ['Order Contact - Person', 'Lender', 'SellingAgentBroker', 'Escrow Company']) {
    const r = await getLookupTable(t);
    const items = r.success && Array.isArray(r.data) ? r.data : [];
    const hit = items.find((row) => codeOf(row) === WANT);
    console.log(JSON.stringify({
      userType: t,
      ok: r.success,
      n: items.length,
      hit: hit ?? null,
      err: r.error?.message ?? null,
    }));
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
