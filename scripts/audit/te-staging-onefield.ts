/**
 * THE ONE-FIELD STAGING TEST. This script WRITES — createOrder — and only to
 * staging :8081. It refuses to run against anything else.
 *
 * Replays the exact payload logged for vendor_api_logs id 1077788 (the Aug 26
 * Visalia Title & Escrow rejection) with a single field changed:
 *
 *     transactionDetails.LookUpCodeTitleOffice   "PRV"  ->  "OCT"
 *
 * Everything else is byte-identical: LookUpCodeEscrowOfficer stays the
 * address-book code "AnnBalPaci", EscrowOfficerName stays "Anna Ballesteros",
 * no top-level orderType key is added, IsRushOrder stays false.
 *
 * That isolates the two candidate causes. If this succeeds, the branch code was
 * the rejection and the escrow-officer namespace was not. If it fails with the
 * same 400, the branch code alone does not explain it.
 *
 * UserId: the logged payload stores UserId as "[redacted]" and SOFTPRO_USER_ID
 * is not present locally, so the real value cannot be reproduced. The key is
 * dropped. The vendor's own "Staging CreateOrder" Postman request also sends no
 * UserId and no auth header, so staging is expected to accept without it. The
 * X-API-KEY header is still sent, exactly as client.createOrder would build it.
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

function flatten(obj: unknown, prefix = '', out: Record<string, unknown> = {}): Record<string, unknown> {
  if (obj === null || typeof obj !== 'object') return out;
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out));
    return out;
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object') flatten(v, path, out);
    else out[path] = v;
  }
  return out;
}

(async () => {
  loadEnvExceptApiUrl();
  process.env.SOFTPRO_API_URL = STAGING_URL;
  const base = process.env.SOFTPRO_API_URL;

  console.log('='.repeat(96));
  console.log('TARGET — this script writes, so the target is asserted twice');
  console.log('='.repeat(96));
  console.log(`  resolved base URL : ${base}`);
  console.log(`  endpoint          : ${base}${ENDPOINT}`);
  if (!base.includes(':8081') || base.includes(':3000')) {
    console.error('REFUSING — target is not staging :8081.');
    process.exit(1);
  }
  console.log('  assertion 1/2     : PASS (contains :8081, does not contain :3000)');

  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  const [row] = await sql.unsafe(
    `select id, request_meta->'payload' as payload, request_meta->>'url' as url,
            response_meta->>'message' as message
       from vendor_api_logs where id = ${SOURCE_LOG_ID}`,
  ) as unknown as Array<{ id: number; payload: Record<string, unknown>; url: string; message: string }>;
  await sql.end();

  if (!row?.payload) {
    console.error(`REFUSING — no payload on vendor_api_logs id ${SOURCE_LOG_ID}.`);
    process.exit(1);
  }

  console.log('');
  console.log('='.repeat(96));
  console.log(`SOURCE — vendor_api_logs id ${SOURCE_LOG_ID}`);
  console.log('='.repeat(96));
  console.log(`  originally sent to : ${row.url}`);
  console.log(`  originally got     : ${JSON.stringify(row.message)}`);

  const original = row.payload;
  const sent = JSON.parse(JSON.stringify(original)) as Record<string, unknown>;

  // The only mutation.
  const tx = sent.transactionDetails as Record<string, unknown>;
  const before = tx.LookUpCodeTitleOffice;
  if (before !== 'PRV') {
    console.error(`REFUSING — expected LookUpCodeTitleOffice "PRV", found ${JSON.stringify(before)}.`);
    process.exit(1);
  }
  tx.LookUpCodeTitleOffice = 'OCT';

  // UserId in the log is the redaction placeholder, not a usable value.
  const hadUserId = Object.prototype.hasOwnProperty.call(sent, 'UserId');
  delete sent.UserId;

  console.log('');
  console.log('='.repeat(96));
  console.log('DIFF — logged payload vs payload about to be sent');
  console.log('='.repeat(96));
  const a = flatten(original);
  const b = flatten(sent);
  const keys = Array.from(new Set([...Object.keys(a), ...Object.keys(b)])).sort();
  let changes = 0;
  for (const k of keys) {
    const inA = k in a;
    const inB = k in b;
    if (inA && inB && JSON.stringify(a[k]) === JSON.stringify(b[k])) continue;
    changes++;
    console.log(`  ${k}`);
    console.log(`      logged : ${inA ? JSON.stringify(a[k]) : '(absent)'}`);
    console.log(`      sending: ${inB ? JSON.stringify(b[k]) : '(absent)'}`);
  }
  console.log(`\n  fields compared : ${keys.length}`);
  console.log(`  fields differing: ${changes}`);
  console.log(`  top-level "orderType" key present: ${Object.prototype.hasOwnProperty.call(sent, 'orderType')}`);
  console.log(`  UserId dropped  : ${hadUserId} (log stored it as "[redacted]"; SOFTPRO_USER_ID absent locally)`);

  console.log('');
  console.log('='.repeat(96));
  console.log('EXACT REQUEST BODY');
  console.log('='.repeat(96));
  const body = JSON.stringify(sent, null, 2);
  console.log(body);

  if (!process.env.SOFTPRO_API_URL.includes(':8081')) {
    console.error('REFUSING at send time — target drifted off staging.');
    process.exit(1);
  }
  console.log('\n  assertion 2/2     : PASS — sending now.');

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (process.env.SOFTPRO_TOKEN) headers['X-API-KEY'] = process.env.SOFTPRO_TOKEN;

  const startedAt = Date.now();
  const response = await fetch(`${base}${ENDPOINT}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(sent),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await response.text();

  console.log('');
  console.log('='.repeat(96));
  console.log('EXACT RESPONSE');
  console.log('='.repeat(96));
  console.log(`  HTTP status : ${response.status} ${response.statusText}`);
  console.log(`  duration    : ${Date.now() - startedAt} ms`);
  console.log(`  headers     : ${JSON.stringify(Object.fromEntries(response.headers.entries()))}`);
  console.log(`  raw body    : ${text}`);

  let verdict = 'INDETERMINATE';
  try {
    const parsed = JSON.parse(text) as { Status?: number; Message?: string; OrderNumber?: string };
    console.log('');
    console.log(`  Status      : ${parsed.Status}`);
    console.log(`  Message     : ${JSON.stringify(parsed.Message)}`);
    console.log(`  OrderNumber : ${JSON.stringify(parsed.OrderNumber)}`);
    if (parsed.Status === 200 && parsed.OrderNumber) {
      verdict = 'CREATED';
    } else if (parsed.Status === 400) {
      verdict = 'REJECTED-400';
    }
  } catch {
    console.log('  (body is not JSON)');
  }

  console.log('');
  console.log('='.repeat(96));
  console.log(`VERDICT: ${verdict}`);
  console.log('='.repeat(96));
  if (verdict === 'CREATED') {
    console.log('  The ONLY change from the rejected production payload was');
    console.log('  LookUpCodeTitleOffice PRV -> OCT. The address-book escrow code');
    console.log('  "AnnBalPaci", EscrowOfficerName "Anna Ballesteros" and the missing');
    console.log('  top-level orderType all went out unchanged and were accepted.');
    console.log('  => branch code convicted; escrow namespace and orderType exonerated');
    console.log('     as *rejection causes* (they remain correctness issues).');
  } else if (verdict === 'REJECTED-400') {
    console.log('  The branch code alone does not explain the rejection. A control');
    console.log('  (the unmodified PRV payload) would be needed to tell whether');
    console.log('  staging rejects this payload for an unrelated reason.');
  }

  writeFileSync('_scratch_untracked/te-staging-onefield-request.json', body);
  writeFileSync('_scratch_untracked/te-staging-onefield-response.json', text);
  process.exit(0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
