/**
 * READ-ONLY. Pre-flight for the one-field staging test.
 *
 * Establishes, before any write is attempted:
 *   1. that SOFTPRO_API_URL is forced to staging :8081 and never inherits the
 *      production value that sits in .env.local
 *   2. that :8081 is genuinely a separate instance — a known production order
 *      must return ZERO records there
 *   3. that staging carries the lookup codes payload 1077788 references, so a
 *      failure cannot be blamed on missing staging reference data
 *   4. whether staging requires the adapter UserId at all
 *
 * Makes no writes of any kind.
 */
import { readFileSync } from 'node:fs';

const STAGING_URL = 'http://100.29.181.61:8081/api/';
const PRODUCTION_URL = 'http://100.29.181.61:3000/api/';
const PROD_CONTROL_ORDER = '20021428-PRV';

// Load .env.local by hand so SOFTPRO_API_URL can be excluded. Using
// `--env-file=.env.local` would silently point this at production :3000.
function loadEnvExceptApiUrl(): void {
  let raw: string;
  try {
    raw = readFileSync('.env.local', 'utf8');
  } catch {
    console.error('REFUSING. .env.local not readable.');
    process.exit(1);
  }
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

  const resolved = process.env.SOFTPRO_API_URL;
  console.log('='.repeat(96));
  console.log('TARGET RESOLUTION');
  console.log('='.repeat(96));
  console.log(`  .env.local SOFTPRO_API_URL : ${PRODUCTION_URL}  <- deliberately NOT loaded`);
  console.log(`  forced SOFTPRO_API_URL     : ${resolved}`);
  console.log(`  contains ":8081"           : ${resolved.includes(':8081')}`);
  console.log(`  SOFTPRO_TOKEN present      : ${process.env.SOFTPRO_TOKEN ? 'yes' : 'no'}`);
  console.log(`  SOFTPRO_USER_ID present    : ${process.env.SOFTPRO_USER_ID ? 'yes' : 'NO'}`);
  if (!resolved.includes(':8081')) {
    console.error('REFUSING — not staging.');
    process.exit(1);
  }

  // Imported only after the env is pinned; getBaseUrl() reads process.env lazily
  // but a late import removes any doubt about ordering.
  const { getOrderDetails, getLookupTable, getSalesReps } = await import('../../src/lib/integrations/softpro/client');

  console.log('');
  console.log('='.repeat(96));
  console.log('SEPARATION CHECK — a production order must NOT exist on staging');
  console.log('='.repeat(96));
  const sep = await getOrderDetails({ dateFrom: '2026-07-01', dateTo: '2026-09-01', orderNumber: PROD_CONTROL_ORDER });
  const n = sep.success && Array.isArray(sep.data) ? sep.data.length : -1;
  console.log(`  production order ${PROD_CONTROL_ORDER} on :8081 -> ${n} record(s)  (success=${sep.success}, err=${sep.error?.message ?? 'none'})`);
  console.log(n === 0 ? '  SEPARATION CONFIRMED — :8081 is not production.' : '  *** NOT SEPARATED — do not write. ***');

  console.log('');
  console.log('='.repeat(96));
  console.log('STAGING REFERENCE DATA — does :8081 know the codes payload 1077788 uses?');
  console.log('='.repeat(96));

  const to = await getLookupTable('Title Officer');
  const toRows = (to.success && Array.isArray(to.data) ? to.data : []) as Array<Record<string, string>>;
  console.log(`\n  Title Officer feed: ${toRows.length} row(s) (success=${to.success})`);
  for (const r of toRows) {
    console.log(`    ${String(r['Title officer/Examiner'] ?? '').padEnd(20)} ${String(r['Office LookupCode'] ?? '').padEnd(8)} ${String(r['Officer Name'] ?? '')}`);
  }
  const offices = new Set(toRows.map((r) => String(r['Office LookupCode'] ?? '').trim()).filter(Boolean));
  console.log(`    valid Office LookupCodes on staging: ${Array.from(offices).sort().join(', ') || '(none)'}`);
  console.log(`    "OCT" present : ${offices.has('OCT')}`);
  console.log(`    "PRV" present : ${offices.has('PRV')}`);
  console.log(`    PCT\\cvirata present : ${toRows.some((r) => String(r['Title officer/Examiner'] ?? '').trim() === 'PCT\\cvirata')}`);

  const eo = await getLookupTable('Escrow Officer');
  const eoRows = (eo.success && Array.isArray(eo.data) ? eo.data : []) as Array<Record<string, string>>;
  console.log(`\n  Escrow Officer feed: ${eoRows.length} row(s) (success=${eo.success})`);
  for (const r of eoRows) {
    console.log(`    ${String(r['Escrow officer/Closer'] ?? '').padEnd(20)} ${String(r['Office LookupCode'] ?? '').padEnd(8)} ${String(r['Officer Name'] ?? '')}`);
  }

  const reps = await getSalesReps();
  const repRows = (reps.success && Array.isArray(reps.data) ? reps.data : []) as Array<Record<string, string>>;
  console.log(`\n  Sales rep feed: ${repRows.length} row(s) (success=${reps.success})`);
  console.log(`    "OrangeCountyHouseAccount" present : ${repRows.some((r) => String(r.LookUpCode ?? '').trim() === 'OrangeCountyHouseAccount')}`);

  console.log('');
  console.log('='.repeat(96));
  console.log('AUTH SHAPE — what the vendor\'s own Staging CreateOrder example sends');
  console.log('='.repeat(96));
  console.log('  Postman "Staging" > "Staging CreateOrder": header[] is empty and the body');
  console.log('  carries no UserId key. Staging appears to be unauthenticated.');

  process.exit(0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
