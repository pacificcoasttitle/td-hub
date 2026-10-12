/**
 * CONTROL WRITE, staging :8081 only. Refuses any other target.
 *
 * TEST-20002219-OCT (Title only, LookUpCodeEscrowOfficer null, EscrowOfficerName
 * "") came back with EscrowOfficer "PCT\rsupport", while production Title only
 * order 20021378-GLT (null code, null name) has no EscrowOfficer key at all.
 *
 * Two candidate explanations: the empty name makes SoftPro assign a default, or
 * staging assigns the API service account to any order with no escrow officer.
 * This sends the identical body with EscrowOfficerName null — the value
 * production sends today — so the only difference between this order and
 * TEST-20002219-OCT is that one field.
 */
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

const STAGING_URL = 'http://100.29.181.61:8081/api/';
const ENDPOINT = 'ordercreation/create';
const SOURCE_LOG_ID = 1077788;

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
  const base = process.env.SOFTPRO_API_URL;
  console.log(`  resolved base URL : ${base}`);
  if (!base.includes(':8081') || base.includes(':3000')) {
    console.error('REFUSING — target is not staging :8081.');
    process.exit(1);
  }
  console.log('  target assertion  : PASS');

  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  const [row] = await sql.unsafe(
    `select request_meta->'payload' as payload from vendor_api_logs where id = ${SOURCE_LOG_ID}`,
  ) as unknown as Array<{ payload: Record<string, unknown> }>;
  await sql.end();

  const body = JSON.parse(JSON.stringify(row!.payload)) as Record<string, unknown>;
  delete body.UserId;
  (body.baseDetails as Record<string, unknown>).OrderType = 'Title only';
  const tx = body.transactionDetails as Record<string, unknown>;
  tx.LookUpCodeTitleOffice = 'OCT';
  tx.LookUpCodeEscrowOfficer = null;
  tx.EscrowOfficerName = null;

  console.log('\n  CONTROL — identical to TEST-20002219-OCT except EscrowOfficerName');
  console.log(`    LookUpCodeEscrowOfficer : ${JSON.stringify(tx.LookUpCodeEscrowOfficer)}`);
  console.log(`    EscrowOfficerName       : ${JSON.stringify(tx.EscrowOfficerName)}  (was "" on 2219)`);

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (process.env.SOFTPRO_TOKEN) headers['X-API-KEY'] = process.env.SOFTPRO_TOKEN;

  const response = await fetch(`${base}${ENDPOINT}`, {
    method: 'POST', headers, body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  const text = await response.text();
  console.log(`\n  HTTP ${response.status}: ${text}`);

  const parsed = JSON.parse(text) as { OrderNumber?: string };
  if (!parsed.OrderNumber) process.exit(0);

  console.log(`\n  reading back ${parsed.OrderNumber} …`);
  const { getOrderDetails } = await import('../../src/lib/integrations/softpro/client');
  const day = new Date().toISOString().slice(0, 10);
  const det = await getOrderDetails({ dateFrom: day, dateTo: day, orderNumber: parsed.OrderNumber });
  const list = (Array.isArray(det.data) ? det.data : []) as unknown as Record<string, unknown>[];
  const rec = list.find((r) => String(r.OrderNumber ?? '').trim() === parsed.OrderNumber) ?? list[0];
  for (const k of ['OrderNumber', 'OrderType', 'TitleOfficer', 'EscrowOfficer', 'EscrowOfficerContact']) {
    console.log(`    ${k.padEnd(22)} ${JSON.stringify(rec?.[k])}`);
  }

  console.log('\n  VERDICT');
  const eo = rec?.EscrowOfficer;
  if (eo === undefined) {
    console.log('    null name -> no escrow officer, "" name -> PCT\\rsupport.');
    console.log('    The empty name is the difference. Do NOT send "" on Title only.');
  } else {
    console.log(`    null name -> ${JSON.stringify(eo)}, same as the "" order.`);
    console.log('    The default is staging behaviour for an unassigned escrow officer,');
    console.log('    not something EscrowOfficerName "" introduced.');
  }
  process.exit(0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
