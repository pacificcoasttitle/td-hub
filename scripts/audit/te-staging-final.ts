/**
 * END-TO-END CHECK OF THE FINISHED PAYLOAD. This script WRITES — createOrder —
 * and only to staging :8081. It refuses to run against anything else, and it
 * never touches production.
 *
 * Phase 1 changed one field and proved the branch code was the rejection. This
 * sends the payload the fixed builder now produces, so the two remaining
 * changes get tested against a real SoftPro rather than against a unit test:
 *
 *     LookUpCodeTitleOffice     "PRV"               -> "OCT"
 *     LookUpCodeEscrowOfficer   "AnnBalPaci"        -> "PCT\aballesteros"
 *     EscrowOfficerName         "Anna Ballesteros"  -> ""
 *
 * Then the same order as Title only, where the single change is
 * EscrowOfficerName null -> "". That is the only field the fix alters on a path
 * that already works, so it is the only regression risk worth spending a write
 * on.
 *
 * Both bodies start from the payload logged for vendor_api_logs id 1077788, so
 * everything not listed above stays byte-identical to a real order.
 *
 * UserId is dropped for the same reason as in Phase 1: the log stores it as the
 * redaction placeholder and SOFTPRO_USER_ID is not set locally. The vendor's own
 * "Staging CreateOrder" Postman request sends none either.
 */
import { readFileSync, writeFileSync } from 'node:fs';
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

interface SendResult { label: string; status: number; verdict: string; orderNumber: string | null; message: string | null }

async function send(label: string, body: Record<string, unknown>): Promise<SendResult> {
  const base = process.env.SOFTPRO_API_URL!;
  if (!base.includes(':8081')) {
    console.error('REFUSING at send time — target drifted off staging.');
    process.exit(1);
  }

  const tx = body.transactionDetails as Record<string, unknown>;
  console.log('');
  console.log('='.repeat(96));
  console.log(`SENDING — ${label}`);
  console.log('='.repeat(96));
  console.log(`  OrderType               : ${JSON.stringify((body.baseDetails as Record<string, unknown>).OrderType)}`);
  console.log(`  LookUpCodeTitleOffice   : ${JSON.stringify(tx.LookUpCodeTitleOffice)}`);
  console.log(`  TitleOffice             : ${JSON.stringify(tx.TitleOffice)}`);
  console.log(`  LookUpCodeEscrowOfficer : ${JSON.stringify(tx.LookUpCodeEscrowOfficer)}`);
  console.log(`  EscrowOfficerName       : ${JSON.stringify(tx.EscrowOfficerName)}`);

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (process.env.SOFTPRO_TOKEN) headers['X-API-KEY'] = process.env.SOFTPRO_TOKEN;

  const startedAt = Date.now();
  const response = await fetch(`${base}${ENDPOINT}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  const text = await response.text();

  console.log(`  HTTP status : ${response.status} ${response.statusText}  (${Date.now() - startedAt} ms)`);
  console.log(`  raw body    : ${text}`);

  let verdict = 'INDETERMINATE';
  let orderNumber: string | null = null;
  let message: string | null = null;
  try {
    const parsed = JSON.parse(text) as { Status?: number; Message?: string; OrderNumber?: string };
    message = parsed.Message ?? null;
    orderNumber = parsed.OrderNumber ?? null;
    if (parsed.Status === 200 && parsed.OrderNumber) verdict = 'CREATED';
    else if (parsed.Status === 400) verdict = 'REJECTED-400';
  } catch { /* leave INDETERMINATE */ }

  console.log(`  VERDICT     : ${verdict}${orderNumber ? ` (${orderNumber})` : ''}`);
  return { label, status: response.status, verdict, orderNumber, message };
}

(async () => {
  loadEnvExceptApiUrl();
  process.env.SOFTPRO_API_URL = STAGING_URL;
  const base = process.env.SOFTPRO_API_URL;

  console.log('='.repeat(96));
  console.log('TARGET — this script writes, so the target is asserted before anything else');
  console.log('='.repeat(96));
  console.log(`  resolved base URL : ${base}`);
  console.log(`  endpoint          : ${base}${ENDPOINT}`);
  if (!base.includes(':8081') || base.includes(':3000')) {
    console.error('REFUSING — target is not staging :8081.');
    process.exit(1);
  }
  console.log('  assertion         : PASS (contains :8081, does not contain :3000)');

  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  const [row] = await sql.unsafe(
    `select request_meta->'payload' as payload from vendor_api_logs where id = ${SOURCE_LOG_ID}`,
  ) as unknown as Array<{ payload: Record<string, unknown> }>;
  await sql.end();

  if (!row?.payload) {
    console.error(`REFUSING — no payload on vendor_api_logs id ${SOURCE_LOG_ID}.`);
    process.exit(1);
  }

  const clone = () => JSON.parse(JSON.stringify(row.payload)) as Record<string, unknown>;

  const teBody = clone();
  delete teBody.UserId;
  const teTx = teBody.transactionDetails as Record<string, unknown>;
  if (teTx.LookUpCodeTitleOffice !== 'PRV' || teTx.LookUpCodeEscrowOfficer !== 'AnnBalPaci') {
    console.error('REFUSING — source payload is not the one this script was written against.');
    process.exit(1);
  }
  teTx.LookUpCodeTitleOffice = 'OCT';
  teTx.LookUpCodeEscrowOfficer = 'PCT\\aballesteros';
  teTx.EscrowOfficerName = '';

  const toBody = clone();
  delete toBody.UserId;
  (toBody.baseDetails as Record<string, unknown>).OrderType = 'Title only';
  const toTx = toBody.transactionDetails as Record<string, unknown>;
  toTx.LookUpCodeTitleOffice = 'OCT';
  toTx.LookUpCodeEscrowOfficer = null;
  toTx.EscrowOfficerName = '';

  writeFileSync('_scratch_untracked/te-staging-final-te-request.json', JSON.stringify(teBody, null, 2));
  writeFileSync('_scratch_untracked/te-staging-final-to-request.json', JSON.stringify(toBody, null, 2));

  const results = [
    await send('TITLE & ESCROW — the payload the fix now produces', teBody),
    await send('TITLE ONLY — regression check on EscrowOfficerName ""', toBody),
  ];

  console.log('');
  console.log('='.repeat(96));
  console.log('SUMMARY');
  console.log('='.repeat(96));
  for (const r of results) {
    console.log(`  ${r.verdict.padEnd(14)} ${String(r.orderNumber ?? r.message).padEnd(24)} ${r.label}`);
  }
  console.log('\n  read back with:');
  for (const r of results) {
    if (r.orderNumber) console.log(`    npx tsx scripts/audit/te-staging-readback.ts ${r.orderNumber}`);
  }
  process.exit(0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
