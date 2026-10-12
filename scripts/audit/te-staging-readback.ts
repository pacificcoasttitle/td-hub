/**
 * READ-ONLY. Reads back the staging order the one-field test created, to see
 * what SoftPro actually did with the fields we left untouched — in particular
 * whether the address-book escrow code "AnnBalPaci" resolved to an escrow
 * officer or was silently dropped.
 */
import { readFileSync } from 'node:fs';

const STAGING_URL = 'http://100.29.181.61:8081/api/';
const ORDER = process.argv[2] ?? 'TEST-20002217-OCT';

function loadEnvExceptApiUrl(): void {
  const raw = readFileSync('.env.local', 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1]!;
    if (key === 'SOFTPRO_API_URL') continue;
    let val = m[2]!.trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

(async () => {
  loadEnvExceptApiUrl();
  process.env.SOFTPRO_API_URL = STAGING_URL;
  console.log(`base URL: ${process.env.SOFTPRO_API_URL}`);
  console.log(`order   : ${ORDER}\n`);

  const { getOrderDetails, getOrderContacts } = await import('../../src/lib/integrations/softpro/client');
  const day = new Date().toISOString().slice(0, 10);

  const det = await getOrderDetails({ dateFrom: day, dateTo: day, orderNumber: ORDER });
  const rows = (Array.isArray(det.data) ? det.data : []) as unknown as Record<string, unknown>[];
  const rec = rows.find((r) => String(r.OrderNumber ?? '').trim() === ORDER) ?? rows[0];
  console.log('--- GetOrderDetails ---');
  if (!rec) {
    console.log(`(no record; success=${det.success}, err=${det.error?.message ?? 'none'})`);
  } else {
    for (const k of Object.keys(rec)) {
      const v = rec[k];
      console.log(`  ${k.padEnd(24)} ${typeof v === 'object' ? JSON.stringify(v) : JSON.stringify(v)}`);
    }
  }

  const con = await getOrderContacts(ORDER);
  console.log('\n--- GetOrderContacts ---');
  if (!con.success) {
    console.log(`(failed: ${con.error?.message})`);
  } else {
    const d = con.data as unknown as Record<string, unknown>;
    for (const k of Object.keys(d)) {
      console.log(`  ${k.padEnd(22)} ${JSON.stringify(d[k])}`);
    }
  }
  process.exit(0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
