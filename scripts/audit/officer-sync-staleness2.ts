/**
 * READ-ONLY. Follow-up to officer-sync-staleness.ts.
 *
 *  a) Dumps the SoftPro Escrow Officer feed verbatim, including its own
 *     "Row State" and "LastModifiedAt" columns, so "Unchanged" can be read as
 *     the sentinel it appears to be rather than as a value.
 *  b) Separates the dedupe guard's ACTUAL behaviour (its LIKE pattern escapes
 *     the % and so matches only the literal string 'PCT%') from its INTENDED
 *     behaviour (prefix match on 'PCT\').
 *
 * GET only. No writes on either side.
 */
import postgres from 'postgres';

const BASE = process.env.SOFTPRO_API_URL!;
const TOKEN = process.env.SOFTPRO_TOKEN;

type Item = Record<string, string>;
type Row = Record<string, unknown>;

(async () => {
  console.log(`SoftPro base URL: ${BASE}  (port ${new URL(BASE).port} = PRODUCTION), GET only\n`);

  const url = `${BASE}lookup/GetLookuptable?userType=${encodeURIComponent('Escrow Officer')}&Page=1&pageSize=1000`;
  const headers: Record<string, string> = {};
  if (TOKEN) headers['X-API-KEY'] = TOKEN;
  const res = await fetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(120_000) });
  const body = JSON.parse(await res.text()) as { data: Item[] };
  const items = body.data ?? [];

  console.log('=== SoftPro Escrow Officer feed, verbatim ===\n');
  console.log(JSON.stringify(items, null, 2));

  console.log('\n\n=== Same feed, tabulated with Row State / LastModifiedAt ===\n');
  const cols = ['Escrow officer/Closer', 'Office LookupCode', 'Officer Name', 'Email', 'Row State', 'LastModifiedAt'];
  console.log('  ' + cols.map((c) => c.padEnd(22)).join(''));
  console.log('  ' + '-'.repeat(cols.length * 22));
  for (const it of items) {
    console.log('  ' + cols.map((c) => String(it[c] ?? '(absent)').slice(0, 21).padEnd(22)).join(''));
  }

  console.log('\n\n=== Title Officer feed, for comparison (does it also emit "Unchanged"?) ===\n');
  const url2 = `${BASE}lookup/GetLookuptable?userType=${encodeURIComponent('Title Officer')}&Page=1&pageSize=1000`;
  const res2 = await fetch(url2, { method: 'GET', headers, signal: AbortSignal.timeout(120_000) });
  const body2 = JSON.parse(await res2.text()) as { data: Item[] };
  console.log(JSON.stringify((body2.data ?? []).slice(0, 4), null, 2));

  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });

  console.log('\n\n=== DEDUPE GUARD: actual (buggy) vs intended semantics ===\n');
  console.log(`  Production emits:  source_id NOT LIKE 'PCT\\%'`);
  console.log(`  Postgres reads \\% as an escaped literal '%', so that pattern matches`);
  console.log(`  exactly the 4-character string 'PCT%' and nothing else. Every real`);
  console.log(`  'PCT\\user' source_id therefore satisfies NOT LIKE and is treated as`);
  console.log(`  "canonical", which makes the guard skip the officer it was meant to keep.\n`);

  const [probe] = await sql.unsafe(`
    select ('PCT\\aballesteros' NOT LIKE 'PCT\\%')          as buggy_not_like,
           ('PCT\\aballesteros' NOT LIKE 'PCT\\\\%')        as intended_not_like,
           ('PCT\\aballesteros' LIKE 'PCT\\%')              as buggy_like,
           (left('PCT\\aballesteros', 4) = 'PCT\\')         as prefix_test
  `) as unknown as Row[];
  console.log(`  'PCT\\aballesteros' NOT LIKE 'PCT\\%'   -> ${String(probe!.buggy_not_like)}   <== what production evaluates`);
  console.log(`  'PCT\\aballesteros' NOT LIKE 'PCT\\\\%' -> ${String(probe!.intended_not_like)}   <== what was intended`);
  console.log(`  left('PCT\\aballesteros',4) = 'PCT\\'   -> ${String(probe!.prefix_test)}`);

  console.log('\n  --- per officer: does the guard skip, under each reading? ---\n');
  for (const it of items) {
    const code = (it['Escrow officer/Closer'] ?? '').trim();
    const email = (it['Email'] ?? '').trim();
    if (!code) continue;
    if (!email) { console.log(`  ${code.padEnd(20)} feed Email empty -> guard cannot fire under either reading`); continue; }
    const esc = email.replace(/'/g, "''");
    const [r] = await sql.unsafe(`
      select
        (select count(*)::int from contacts
          where email = '${esc}' and source_id is not null
            and source_id NOT LIKE 'PCT\\%')   as buggy_hits,
        (select count(*)::int from contacts
          where email = '${esc}' and source_id is not null
            and left(source_id, 4) <> 'PCT\\') as intended_hits
    `) as unknown as Row[];
    const b = Number(r!.buggy_hits), i = Number(r!.intended_hits);
    console.log(`  ${code.padEnd(20)} email=${email.padEnd(26)} buggy_hits=${String(b).padEnd(3)} -> ${b > 0 ? 'SKIPPED (today)' : 'not skipped'}   | intended_hits=${String(i).padEnd(3)} -> ${i > 0 ? 'would skip' : 'would NOT skip'}`);
  }

  console.log('\n\n=== The office-code change that matters: Vidaca ===\n');
  const vid = await sql.unsafe(`
    select id, officer_name, office_lookup_code, lookup_code, softpro_lookup_code,
           closer_examiner, is_escrow_officer, updated_at
      from contacts where softpro_lookup_code = 'PCT\\lvidaca' order by id
  `) as unknown as Row[];
  for (const r of vid) {
    console.log(`  row ${String(r.id).padEnd(6)} office=${String(r.office_lookup_code ?? '(null)').padEnd(7)} lookup_code=${String(r.lookup_code ?? '(null)').padEnd(12)} updated=${new Date(String(r.updated_at)).toISOString()}`);
  }
  const feedVid = items.find((x) => x['Escrow officer/Closer'] === 'PCT\\lvidaca');
  console.log(`  SoftPro now says Office LookupCode = ${JSON.stringify(feedVid?.['Office LookupCode'])}`);

  console.log('\n\n=== Are any ORDERS already carrying the wrong Vidaca branch? ===\n');
  const vidOrders = await sql.unsafe(`
    select o.id, o.file_number, o.escrow_officer_id, o.created_at
      from orders o
     where o.escrow_officer_id in (16, 8996)
     order by o.created_at desc
     limit 10
  `) as unknown as Row[];
  console.log(`  most recent orders assigned to a Vidaca row:`);
  for (const r of vidOrders) {
    console.log(`    order ${String(r.id).padEnd(8)} ${String(r.file_number).padEnd(18)} eo_id=${String(r.escrow_officer_id).padEnd(6)} ${new Date(String(r.created_at)).toISOString()}`);
  }

  await sql.end();
  process.exit(0);
})();
