/**
 * READ-ONLY vendor probe for the missing-buyer gap.
 *
 * 2,103 of 3,584 SoftPro-synced Purchase orders have no `buyer` row in
 * `order_parties`. This asks the vendor directly whether a borrower exists on
 * those files, and splits the answer three ways: absent / present-but-empty /
 * present-with-a-value-we-dropped.
 *
 * Only GET GetOrderContacts and GET GetOrderDetails are called. No writes to
 * SoftPro, no createOrder, and no writes to our Postgres — the raw `fetch` here
 * deliberately bypasses `client.ts` so the probe does not append the
 * `vendor_api_logs` rows that every call through `makeRequest` produces, and so
 * the untouched response envelope is captured rather than the unwrapped `data`.
 *
 * Sample selection SQL and the resulting file numbers are recorded in
 * docs/tickets/SOFTPRO_MISSING_BUYER.md.
 *
 *   npx tsx scripts/audit/softpro-missing-buyer-probe.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

// ─── Sample ──────────────────────────────────────────────────────────────────
// Stratified so the result cannot be an artefact of one age band, one status or
// one branch. `group` is the DB-side fact we are testing the vendor against.

interface SampleRow {
  fileNumber: string;
  stratum: string;
  /** what `order_parties` holds locally today */
  storedBuyer: 'missing' | 'present';
  storedSeller: 'missing' | 'present';
  partyRows: number;
  status: string;
  opened: string;
}

const SAMPLE: SampleRow[] = [
  // A — opened within 14 days: rules out ingestion lag
  { fileNumber: '20021019-GLT', stratum: 'A_recent_14d', storedBuyer: 'missing', storedSeller: 'present', partyRows: 5, status: 'in_process', opened: '2026-08-13' },
  { fileNumber: '20021254-GLT', stratum: 'A_recent_14d', storedBuyer: 'missing', storedSeller: 'present', partyRows: 5, status: 'in_process', opened: '2026-08-19' },
  { fileNumber: '20021273-ONT', stratum: 'A_recent_14d', storedBuyer: 'missing', storedSeller: 'missing', partyRows: 2, status: 'in_process', opened: '2026-08-20' },
  { fileNumber: '20021428-PRV', stratum: 'A_recent_14d', storedBuyer: 'missing', storedSeller: 'present', partyRows: 4, status: 'in_process', opened: '2026-08-25' },
  // B — 15 to 90 days old
  { fileNumber: '20019932-GLT', stratum: 'B_aged_15_90', storedBuyer: 'missing', storedSeller: 'present', partyRows: 5, status: 'in_process', opened: '2026-07-15' },
  { fileNumber: '20018832-OCT', stratum: 'B_aged_15_90', storedBuyer: 'missing', storedSeller: 'present', partyRows: 2, status: 'in_process', opened: '2026-06-12' },
  { fileNumber: '20020933-ONT', stratum: 'B_aged_15_90', storedBuyer: 'missing', storedSeller: 'present', partyRows: 5, status: 'in_process', opened: '2026-08-11' },
  { fileNumber: '20020817-PRV', stratum: 'B_aged_15_90', storedBuyer: 'missing', storedSeller: 'present', partyRows: 4, status: 'in_process', opened: '2026-08-07' },
  // C — older than 90 days
  { fileNumber: '20017185-GLT', stratum: 'C_older_90plus', storedBuyer: 'missing', storedSeller: 'present', partyRows: 4, status: 'in_process', opened: '2026-04-30' },
  { fileNumber: '20015506-OCT', stratum: 'C_older_90plus', storedBuyer: 'missing', storedSeller: 'present', partyRows: 4, status: 'in_process', opened: '2026-03-18' },
  { fileNumber: '20017694-ONT', stratum: 'C_older_90plus', storedBuyer: 'missing', storedSeller: 'present', partyRows: 5, status: 'in_process', opened: '2026-05-14' },
  { fileNumber: '20012563-PRV', stratum: 'C_older_90plus', storedBuyer: 'missing', storedSeller: 'present', partyRows: 6, status: 'in_process', opened: '2026-01-12' },
  // D — terminal statuses: the buyer had every chance to arrive
  { fileNumber: '20011758-GLT', stratum: 'D_completed_closed', storedBuyer: 'missing', storedSeller: 'missing', partyRows: 3, status: 'completed', opened: '2025-12-15' },
  { fileNumber: '20015633-GLT', stratum: 'D_completed_closed', storedBuyer: 'missing', storedSeller: 'missing', partyRows: 4, status: 'closed', opened: '2026-03-21' },
  { fileNumber: '20005524-ONT', stratum: 'D_completed_closed', storedBuyer: 'missing', storedSeller: 'present', partyRows: 5, status: 'closed', opened: '2025-07-22' },
  // E — other parties stored but neither buyer nor seller
  { fileNumber: '20016337-GLT', stratum: 'E_no_seller_other_parties', storedBuyer: 'missing', storedSeller: 'missing', partyRows: 4, status: 'in_process', opened: '2026-04-09' },
  { fileNumber: '20017286-GLT', stratum: 'E_no_seller_other_parties', storedBuyer: 'missing', storedSeller: 'missing', partyRows: 4, status: 'in_process', opened: '2026-05-04' },
  { fileNumber: '20019416-ONT', stratum: 'E_no_seller_other_parties', storedBuyer: 'missing', storedSeller: 'missing', partyRows: 3, status: 'in_process', opened: '2026-06-30' },
  { fileNumber: '20016576-PRV', stratum: 'E_no_seller_other_parties', storedBuyer: 'missing', storedSeller: 'missing', partyRows: 3, status: 'in_process', opened: '2026-04-15' },
  // F — contacts_empty_confirmed = true, no party rows at all
  { fileNumber: '20018364-GLT', stratum: 'F_no_parties_at_all', storedBuyer: 'missing', storedSeller: 'missing', partyRows: 0, status: 'in_process', opened: '2026-06-02' },
  { fileNumber: '20021133-ONT', stratum: 'F_no_parties_at_all', storedBuyer: 'missing', storedSeller: 'missing', partyRows: 0, status: 'in_process', opened: '2026-08-17' },
  // Z — control: purchases that DO have a stored buyer row
  { fileNumber: '20018752-GLT', stratum: 'Z_control_has_buyer', storedBuyer: 'present', storedSeller: 'present', partyRows: 3, status: 'completed', opened: '2026-06-11' },
  { fileNumber: '20017429-OCT', stratum: 'Z_control_has_buyer', storedBuyer: 'present', storedSeller: 'present', partyRows: 9, status: 'completed', opened: '2026-05-07' },
  { fileNumber: '20017912-ONT', stratum: 'Z_control_has_buyer', storedBuyer: 'present', storedSeller: 'missing', partyRows: 8, status: 'in_process', opened: '2026-05-20' },
  { fileNumber: '20015577-PRV', stratum: 'Z_control_has_buyer', storedBuyer: 'present', storedSeller: 'present', partyRows: 8, status: 'in_process', opened: '2026-03-19' },
];

const OUT_DIR = '_scratch_untracked/buyer-probe';

// ─── Env ─────────────────────────────────────────────────────────────────────

function loadEnvLocal(): void {
  const raw = readFileSync('.env.local', 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let val = m[2]!.trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[m[1]!] = val;
  }
}

// ─── Raw reads ───────────────────────────────────────────────────────────────

interface RawRead {
  url: string;
  httpStatus: number | null;
  body: unknown;
  error: string | null;
}

async function get(base: string, endpoint: string, query: Record<string, string>): Promise<RawRead> {
  const url = `${base}${endpoint}?${new URLSearchParams(query).toString()}`;
  const token = process.env.SOFTPRO_TOKEN;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'X-API-KEY': token } : {}),
      },
      signal: AbortSignal.timeout(120_000),
    });
    const text = await res.text();
    try {
      return { url, httpStatus: res.status, body: JSON.parse(text) as unknown, error: null };
    } catch {
      return { url, httpStatus: res.status, body: text, error: 'non-JSON response' };
    }
  } catch (err) {
    return { url, httpStatus: null, body: null, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Deep scan ───────────────────────────────────────────────────────────────
// Catches the failure modes this integration has produced before: a key under a
// different name, a casing mismatch, or an array we would filter to nothing.
// Anything matching /buy|borrow/i anywhere in the payload is surfaced, whether
// or not our types declare it.

interface Hit {
  path: string;
  value: unknown;
  kind: 'value' | 'empty' | 'null';
}

function scanBuyerish(node: unknown, path: string, hits: Hit[]): void {
  if (node === null || node === undefined) return;
  if (Array.isArray(node)) {
    node.forEach((v, i) => scanBuyerish(v, `${path}[${i}]`, hits));
    return;
  }
  if (typeof node !== 'object') return;

  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const childPath = path ? `${path}.${key}` : key;
    // "Preimary" is SoftPro's own misspelling, already tolerated in mapper.ts.
    if (/buy|borrow|preimary/i.test(key)) {
      if (value === null || value === undefined) {
        hits.push({ path: childPath, value, kind: 'null' });
      } else if (typeof value === 'string') {
        hits.push({ path: childPath, value, kind: value.trim() === '' ? 'empty' : 'value' });
      } else if (typeof value === 'object') {
        const leaves: Hit[] = [];
        collectLeaves(value, childPath, leaves);
        const anyValue = leaves.some((l) => l.kind === 'value');
        hits.push({ path: childPath, value, kind: anyValue ? 'value' : leaves.length ? 'empty' : 'null' });
      }
    }
    scanBuyerish(value, childPath, hits);
  }
}

function collectLeaves(node: unknown, path: string, out: Hit[]): void {
  if (node === null || node === undefined) {
    out.push({ path, value: node, kind: 'null' });
    return;
  }
  if (typeof node === 'string') {
    out.push({ path, value: node, kind: node.trim() === '' ? 'empty' : 'value' });
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((v, i) => collectLeaves(v, `${path}[${i}]`, out));
    return;
  }
  if (typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      collectLeaves(v, `${path}.${k}`, out);
    }
    return;
  }
  out.push({ path, value: node, kind: 'value' });
}

function topLevelKeys(body: unknown): string[] {
  if (body === null || typeof body !== 'object') return [];
  const env = body as Record<string, unknown>;
  const data = env.data;
  if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
    return Object.keys(data as Record<string, unknown>);
  }
  return Object.keys(env);
}

function unwrap(body: unknown): unknown {
  if (body === null || typeof body !== 'object') return body;
  const env = body as Record<string, unknown>;
  return 'data' in env ? env.data : env;
}

// ─── Classification ──────────────────────────────────────────────────────────

type Bucket = 'ABSENT' | 'EMPTY' | 'VALUE_DROPPED' | 'VALUE_STORED' | 'READ_FAILED';

interface Finding {
  row: SampleRow;
  bucket: Bucket;
  contactsKeys: string[];
  buyerHits: Hit[];
  realValues: Hit[];
  mappedBuyerName: string | null;
  mappedSecondaryName: string | null;
  mappedSellerName: string | null;
  detailBuyerHits: Hit[];
  note: string;
}

(async () => {
  loadEnvLocal();
  const base = (() => {
    const url = process.env.SOFTPRO_API_URL;
    if (!url) throw new Error('SOFTPRO_API_URL is not configured');
    return url.endsWith('/') ? url : `${url}/`;
  })();

  mkdirSync(OUT_DIR, { recursive: true });

  console.log('='.repeat(78));
  console.log('SoftPro missing-buyer probe — READ-ONLY');
  console.log(`base URL : ${base}`);
  console.log(`token    : ${process.env.SOFTPRO_TOKEN ? 'present' : 'ABSENT'}`);
  console.log(`sample   : ${SAMPLE.length} orders (${SAMPLE.filter((s) => s.storedBuyer === 'missing').length} failing, ${SAMPLE.filter((s) => s.storedBuyer === 'present').length} control)`);
  console.log(`raw dump : ${OUT_DIR}/`);
  console.log('='.repeat(78));

  const { mapOrderContacts } = await import('../../src/lib/integrations/softpro/mapper');
  const findings: Finding[] = [];

  for (const row of SAMPLE) {
    const contacts = await get(base, 'ordercreation/GetOrderContacts', { OrderNumber: row.fileNumber });
    // Wide window: GetOrderDetails filters by date, and the sample spans 14 months.
    const details = await get(base, 'ordercreation/GetOrderDetails', {
      DateFrom: '2025-01-01',
      DateTo: new Date().toISOString().slice(0, 10),
      OrderNumber: row.fileNumber,
    });

    writeFileSync(
      `${OUT_DIR}/${row.fileNumber}.json`,
      JSON.stringify({ fileNumber: row.fileNumber, stratum: row.stratum, contacts, details }, null, 2),
    );

    const contactsData = unwrap(contacts.body);
    const detailsData = unwrap(details.body);

    const buyerHits: Hit[] = [];
    scanBuyerish(contactsData, '', buyerHits);
    const detailBuyerHits: Hit[] = [];
    scanBuyerish(detailsData, '', detailBuyerHits);

    const realValues = buyerHits.filter((h) => h.kind === 'value' && typeof h.value === 'string');
    const detailRealValues = detailBuyerHits.filter((h) => h.kind === 'value' && typeof h.value === 'string');

    let mappedBuyerName: string | null = null;
    let mappedSecondaryName: string | null = null;
    let mappedSellerName: string | null = null;
    let mapError: string | null = null;
    if (contactsData !== null && typeof contactsData === 'object') {
      try {
        const mapped = mapOrderContacts(contactsData as never);
        mappedBuyerName = mapped.parties.buyer?.name ?? null;
        mappedSecondaryName = mapped.parties.secondaryBuyer?.name ?? null;
        mappedSellerName = mapped.parties.seller?.name ?? null;
      } catch (err) {
        mapError = err instanceof Error ? err.message : String(err);
      }
    }

    let bucket: Bucket;
    let note = '';
    if (contacts.error || contacts.httpStatus !== 200) {
      bucket = 'READ_FAILED';
      note = contacts.error ?? `HTTP ${contacts.httpStatus}`;
    } else if (realValues.length > 0 || detailRealValues.length > 0) {
      if (row.storedBuyer === 'present') {
        bucket = 'VALUE_STORED';
      } else {
        bucket = 'VALUE_DROPPED';
        note = mappedBuyerName
          ? 'mapper produced a name but no row was stored'
          : 'vendor value present, mapper produced null';
      }
      if (detailRealValues.length > 0 && realValues.length === 0) {
        note += '; value only in GetOrderDetails';
      }
    } else if (buyerHits.length > 0) {
      bucket = 'EMPTY';
      note = 'buyer key present, all borrower fields blank';
    } else {
      bucket = 'ABSENT';
      note = 'no buyer/borrower key anywhere in payload';
    }
    if (mapError) note += `; mapper threw: ${mapError}`;

    findings.push({
      row,
      bucket,
      contactsKeys: topLevelKeys(contacts.body),
      buyerHits,
      realValues,
      mappedBuyerName,
      mappedSecondaryName,
      mappedSellerName,
      detailBuyerHits,
      note,
    });

    console.log(`\n── ${row.fileNumber}  [${row.stratum}]  stored buyer: ${row.storedBuyer}`);
    console.log(`   HTTP ${contacts.httpStatus ?? 'ERR'}  contacts keys: ${findings.at(-1)!.contactsKeys.join(', ') || '(none)'}`);
    for (const h of buyerHits) {
      console.log(`   contacts  ${h.kind.padEnd(5)}  ${h.path} = ${JSON.stringify(h.value)}`);
    }
    for (const h of detailBuyerHits) {
      console.log(`   details   ${h.kind.padEnd(5)}  ${h.path} = ${JSON.stringify(h.value)}`);
    }
    console.log(`   mapped: buyer=${JSON.stringify(mappedBuyerName)} secondary=${JSON.stringify(mappedSecondaryName)} seller=${JSON.stringify(mappedSellerName)}`);
    console.log(`   => ${bucket}${note ? ` (${note})` : ''}`);
  }

  // ─── Roll-up ───────────────────────────────────────────────────────────────

  console.log(`\n${'='.repeat(78)}`);
  console.log('THREE-WAY SPLIT — failing sample (stored buyer missing)');
  console.log('='.repeat(78));
  const failing = findings.filter((f) => f.row.storedBuyer === 'missing');
  const counts = new Map<Bucket, number>();
  for (const f of failing) counts.set(f.bucket, (counts.get(f.bucket) ?? 0) + 1);
  for (const b of ['ABSENT', 'EMPTY', 'VALUE_DROPPED', 'READ_FAILED'] as Bucket[]) {
    console.log(`  ${b.padEnd(14)} ${counts.get(b) ?? 0} / ${failing.length}`);
  }

  console.log('\nCONTROL GROUP (stored buyer present)');
  const control = findings.filter((f) => f.row.storedBuyer === 'present');
  for (const f of control) {
    console.log(`  ${f.row.fileNumber.padEnd(14)} ${f.bucket.padEnd(14)} mapped=${JSON.stringify(f.mappedBuyerName)} hits=${f.buyerHits.length}`);
  }

  console.log('\nPER-FILE TABLE (markdown)');
  console.log('| File | Stratum | Status | Opened | SoftPro borrower/buyer | Mapped | Stored | Bucket |');
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const f of findings) {
    const vendor = f.realValues.length
      ? f.realValues.map((h) => `\`${h.path}\`=${JSON.stringify(h.value)}`).join('<br>')
      : f.buyerHits.length
        ? `key present, blank (${f.buyerHits.map((h) => h.path).join(', ')})`
        : 'no buyer key';
    console.log(`| ${f.row.fileNumber} | ${f.row.stratum} | ${f.row.status} | ${f.row.opened} | ${vendor} | ${JSON.stringify(f.mappedBuyerName)} | ${f.row.storedBuyer} (${f.row.partyRows} party rows) | ${f.bucket} |`);
  }

  writeFileSync(`${OUT_DIR}/_findings.json`, JSON.stringify({ baseUrl: base, findings }, null, 2));
  console.log(`\nWrote ${OUT_DIR}/_findings.json`);
  process.exit(0);
})().catch((e) => {
  console.error('ERR', e);
  process.exit(1);
});
