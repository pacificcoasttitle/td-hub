/**
 * READ-ONLY, both sides. Answers the only question the DB alone cannot:
 * are the four frozen officer rows carrying STALE data, or merely un-updated?
 *
 * SoftPro side: GET lookup/GetLookuptable?userType=Escrow Officer — a read. No
 * modifiedSince, so the full current feed comes back, which is what we need to
 * diff against. The script refuses to issue anything but a GET, and prints the
 * base URL it used because .env.local points SOFTPRO_API_URL at port 3000,
 * which is PRODUCTION.
 *
 * DB side: SELECTs only.
 */
import postgres from 'postgres';

const BASE = process.env.SOFTPRO_API_URL!;
const TOKEN = process.env.SOFTPRO_TOKEN;

type Item = Record<string, string>;
type Row = Record<string, unknown>;

/** Fields syncEscrowOfficers would write, mapped feed-key -> contacts column. */
const WRITTEN_FIELDS: Array<[string, string]> = [
  ['Escrow officer/Closer', 'closer_examiner'],
  ['Escrow officer/Closer', 'softpro_lookup_code'],
  ['Office LookupCode', 'office_lookup_code'],
  ['Office LookupCode', 'lookup_code'],
  ['Officer Name', 'officer_name'],
  ['Email', 'email'],
];

(async () => {
  console.log(`SoftPro base URL : ${BASE}`);
  console.log(`  -> port ${new URL(BASE).port} = ${new URL(BASE).port === '3000' ? 'PRODUCTION' : 'NOT production'}`);
  console.log(`  -> method GET only, GetLookuptable. No write of any kind.\n`);

  const url = `${BASE}lookup/GetLookuptable?userType=${encodeURIComponent('Escrow Officer')}&Page=1&pageSize=1000`;
  console.log(`GET ${url}\n`);

  const headers: Record<string, string> = {};
  if (TOKEN) headers['X-API-KEY'] = TOKEN;

  const res = await fetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(120_000) });
  const text = await res.text();
  console.log(`HTTP ${res.status}, ${text.length} bytes`);

  let items: Item[] = [];
  try {
    const body = JSON.parse(text) as Record<string, unknown>;
    const candidate =
      (body.data as Item[]) ??
      (body.Data as Item[]) ??
      (body.Result as Item[]) ??
      (body.result as Item[]) ??
      (body.Items as Item[]) ??
      (Array.isArray(body) ? (body as unknown as Item[]) : []);
    items = Array.isArray(candidate) ? candidate : [];
    console.log(`Top-level keys: ${Object.keys(body).join(', ')}`);
    console.log(`Status/Message: ${String(body.Status)} / ${String(body.Message)}`);
    console.log(`Pagination: ${JSON.stringify(body.Pagination)}`);
    console.log(`Feed rows: ${items.length}`);
    if (items.length === 0) {
      console.log(`RAW BODY (first 1200 chars):\n${text.slice(0, 1200)}`);
    }
  } catch {
    console.log(`Could not parse JSON. First 600 chars:\n${text.slice(0, 600)}`);
  }

  if (items.length > 0) {
    console.log(`\nFeed row keys: ${Object.keys(items[0]!).join(' | ')}`);
  }

  const feedByCode = new Map<string, Item>();
  for (const it of items) {
    const code = (it['Escrow officer/Closer'] ?? '').trim();
    if (code) feedByCode.set(code, it);
  }

  console.log('\n--- every PCT\\ row in the SoftPro Escrow Officer feed ---');
  for (const [code, it] of [...feedByCode].filter(([c]) => c.startsWith('PCT\\'))) {
    console.log(`  ${code.padEnd(20)} office=${String(it['Office LookupCode'] ?? '').padEnd(6)} name=${String(it['Officer Name'] ?? '').padEnd(24)} email=${String(it['Email'] ?? '')}`);
  }

  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });

  const rows = await sql.unsafe(`
    select id, officer_name, full_name, email, lookup_code, office_lookup_code,
           softpro_lookup_code, closer_examiner, source_id, roles::text as roles,
           softpro_user_type, is_escrow_officer, is_active, updated_at
      from contacts
     where left(coalesce(softpro_lookup_code,''), 4) = 'PCT\\'
       and coalesce(roles::text,'') like '%escrow_officer%'
        or id in (8996, 10642, 10999, 17165)
     order by id
  `) as unknown as Row[];

  console.log('\n\n=== FIELD-BY-FIELD DIFF: SoftPro feed vs the contacts row the sync targets ===\n');

  const summary: Array<{ code: string; row: string; verdict: string; detail: string }> = [];

  for (const code of [...feedByCode.keys()].filter((c) => c.startsWith('PCT\\')).sort()) {
    const feed = feedByCode.get(code)!;
    const matched = rows.filter(
      (r) => r.closer_examiner === code || r.softpro_lookup_code === code,
    );

    console.log(`${'-'.repeat(96)}\n${code}  — predicate matches ${matched.length} contacts row(s)`);

    for (const r of matched) {
      const diffs: string[] = [];
      for (const [feedKey, col] of WRITTEN_FIELDS) {
        const want = (feed[feedKey] ?? '').trim();
        const got = r[col] === null || r[col] === undefined ? '' : String(r[col]).trim();
        if (want && want !== got) diffs.push(`${col}: SoftPro="${want}" vs ours="${got || '(null)'}"`);
      }
      const eoFlag = r.is_escrow_officer === true;
      console.log(`  row ${String(r.id).padEnd(6)} office=${String(r.office_lookup_code ?? '(null)').padEnd(7)} eo_flag=${String(eoFlag).padEnd(5)} updated=${new Date(String(r.updated_at)).toISOString()}`);
      if (diffs.length === 0) {
        console.log(`    CONTENT MATCHES SoftPro on every field the sync writes.`);
      } else {
        for (const d of diffs) console.log(`    STALE  ${d}`);
      }
      summary.push({
        code,
        row: String(r.id),
        verdict: diffs.length === 0 ? 'CURRENT' : 'STALE',
        detail: diffs.join('; ') || 'all written fields equal',
      });
    }
  }

  console.log('\n\n=== SUMMARY ===\n');
  console.log('  code                 row     verdict  detail');
  console.log('  ' + '-'.repeat(110));
  for (const s of summary) {
    console.log(`  ${s.code.padEnd(20)} ${s.row.padEnd(7)} ${s.verdict.padEnd(8)} ${s.detail.slice(0, 90)}`);
  }

  console.log('\n\n=== DEDUPE-GUARD REACHABILITY (would the guard skip the officer before the match runs?) ===');
  console.log(`
The guard skips when a contact shares the officer's email AND has a source_id
that is non-null and not PCT\\-prefixed. If that fires, the officer is never
updated and the unique-violation path is never reached — a different mechanism
for the same silence.
`);
  for (const code of [...feedByCode.keys()].filter((c) => c.startsWith('PCT\\')).sort()) {
    const email = (feedByCode.get(code)!['Email'] ?? '').trim();
    if (!email) { console.log(`  ${code.padEnd(20)} no email on feed row -> guard cannot fire`); continue; }
    const hits = await sql.unsafe(`
      select id, source_id, email from contacts
       where email = '${email.replace(/'/g, "''")}'
         and source_id is not null
         and source_id not like 'PCT\\%'
       limit 5
    `) as unknown as Row[];
    console.log(`  ${code.padEnd(20)} email=${email.padEnd(30)} canonical non-PCT rows: ${hits.length}${hits.length ? ' -> GUARD SKIPS: ' + hits.map((h) => `${h.id}(${h.source_id})`).join(',') : ' -> guard does not fire'}`);
  }

  await sql.end();
  process.exit(0);
})();
