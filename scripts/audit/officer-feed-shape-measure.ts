/**
 * READ-ONLY. Measures the live Escrow Officer feed against the contacts rows,
 * fresh — nothing here is reused from an earlier investigation's captured values.
 *
 * Purpose:
 *  a) Establish the actual key shape of the feed, per row, so a shape guard can
 *     be designed against what the vendor really sends rather than against the
 *     one symptom we happened to notice (an email reading "Unchanged").
 *  b) Print the field-by-field DB-vs-vendor diff for the six PCT officers, which
 *     is the diff a targeted resync would apply.
 *
 * GET only on the vendor side. SELECT only on the database side.
 */
import postgres from 'postgres';

const BASE = process.env.SOFTPRO_API_URL!;
const TOKEN = process.env.SOFTPRO_TOKEN;

type Item = Record<string, string>;
type Row = Record<string, unknown>;

const CODE = 'Escrow officer/Closer';
const SYNCED_FIELDS = [CODE, 'Office LookupCode', 'Officer Name', 'Email', 'Row State'] as const;

async function feed(userType: string): Promise<Item[]> {
  const url = `${BASE}lookup/GetLookuptable?userType=${encodeURIComponent(userType)}&Page=1&pageSize=1000`;
  const headers: Record<string, string> = {};
  if (TOKEN) headers['X-API-KEY'] = TOKEN;
  const res = await fetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(120_000) });
  const body = JSON.parse(await res.text()) as { data?: Item[] };
  return body.data ?? [];
}

(async () => {
  const port = new URL(BASE).port;
  console.log(`SoftPro base URL: ${BASE}`);
  console.log(`  port ${port} => ${port === '3000' ? 'PRODUCTION' : port === '8081' ? 'staging' : 'unknown'}; method GET only\n`);

  const items = await feed('Escrow Officer');
  console.log(`=== Escrow Officer feed: ${items.length} rows, verbatim ===\n`);
  console.log(JSON.stringify(items, null, 2));

  // (a) Key shape, per row. A column shift shows up here as a key set that
  // differs from the majority, not as a bad value in a known-good key.
  console.log('\n\n=== Key shape per row (this is what a shape guard can test) ===\n');
  const keyCounts = new Map<string, number>();
  for (const it of items) for (const k of Object.keys(it)) keyCounts.set(k, (keyCounts.get(k) ?? 0) + 1);
  console.log('  key frequency across all rows:');
  for (const [k, n] of [...keyCounts].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${k.padEnd(26)} present on ${n}/${items.length} rows`);
  }

  console.log('\n  per-row: which of the expected keys are present / non-empty?\n');
  for (const it of items) {
    const code = (it[CODE] ?? '').trim() || '(no code)';
    const flags = SYNCED_FIELDS.map((f) => {
      const present = Object.prototype.hasOwnProperty.call(it, f);
      const v = (it[f] ?? '').trim();
      return `${f}=${!present ? 'ABSENT' : v === '' ? 'EMPTY' : JSON.stringify(v).slice(0, 24)}`;
    });
    console.log(`  ${code.padEnd(20)} keys=${Object.keys(it).length}  ${flags.join('  ')}`);
  }

  // (b) DB vs vendor, field by field.
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  console.log('\n\n=== DB vs VENDOR, field by field, for every PCT officer on the feed ===\n');

  for (const it of items) {
    const code = (it[CODE] ?? '').trim();
    if (!code) {
      console.log(`  (row with absent/empty ${CODE}; keys=${JSON.stringify(Object.keys(it))})\n`);
      continue;
    }
    const rows = await sql`
      select id, officer_name, office_lookup_code, lookup_code, email,
             softpro_lookup_code, closer_examiner, source_id,
             is_escrow_officer, is_active, updated_at
        from contacts
       where softpro_lookup_code = ${code} or closer_examiner = ${code}
       order by id
    ` as unknown as Row[];

    console.log(`  ${code}   (${rows.length} contacts row(s))`);
    console.log(`    vendor: office=${JSON.stringify(it['Office LookupCode'] ?? null)} name=${JSON.stringify(it['Officer Name'] ?? null)} email=${JSON.stringify(it['Email'] ?? null)} rowState=${JSON.stringify(it['Row State'] ?? null)}`);
    for (const r of rows) {
      const isOfficerRow = r.closer_examiner !== null;
      console.log(`    db row ${String(r.id).padEnd(6)} ${isOfficerRow ? '[officer/closer_examiner set]' : '[address-book, closer_examiner NULL]'}`);
      console.log(`      office_lookup_code=${JSON.stringify(r.office_lookup_code)} lookup_code=${JSON.stringify(r.lookup_code)} officer_name=${JSON.stringify(r.officer_name)}`);
      console.log(`      email=${JSON.stringify(r.email)} is_escrow_officer=${String(r.is_escrow_officer)} is_active=${String(r.is_active)} source_id=${JSON.stringify(r.source_id)}`);
      console.log(`      updated_at=${new Date(String(r.updated_at)).toISOString()}`);
      if (isOfficerRow) {
        const drift: string[] = [];
        const vOffice = (it['Office LookupCode'] ?? '').trim();
        const vName = (it['Officer Name'] ?? '').trim();
        const vEmail = (it['Email'] ?? '').trim();
        if (vOffice && vOffice !== String(r.office_lookup_code ?? '')) drift.push(`office_lookup_code ${JSON.stringify(r.office_lookup_code)} -> ${JSON.stringify(vOffice)}`);
        if (vOffice && vOffice !== String(r.lookup_code ?? '')) drift.push(`lookup_code ${JSON.stringify(r.lookup_code)} -> ${JSON.stringify(vOffice)}`);
        if (vName && vName !== String(r.officer_name ?? '')) drift.push(`officer_name ${JSON.stringify(r.officer_name)} -> ${JSON.stringify(vName)}`);
        if (vEmail && vEmail !== String(r.email ?? '')) drift.push(`email ${JSON.stringify(r.email)} -> ${JSON.stringify(vEmail)}`);
        if (r.is_escrow_officer !== true) drift.push('is_escrow_officer false -> true');
        console.log(`      DRIFT: ${drift.length === 0 ? '(none — already matches vendor)' : drift.join('; ')}`);
      }
    }
    console.log('');
  }

  console.log('\n=== contact_sync_state for Escrow Officer (the cursor) ===\n');
  const state = await sql`
    select entity_type, job_type, status, cursor_lookup_code, last_synced_at,
           last_completed_at, next_allowed_at, total_fetched, last_error, updated_at
      from contact_sync_state where entity_type = 'Escrow Officer'
  ` as unknown as Row[];
  console.log(JSON.stringify(state, null, 2));

  await sql.end();
  process.exit(0);
})();
