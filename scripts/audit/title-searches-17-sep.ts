/**
 * READ-ONLY. The six orders from 17 September whose title searches never
 * completed.
 *
 * Three questions per order, and nothing else:
 *
 *   1. What state is the search request actually in?
 *   2. Was anything ever sent to TitlePoint?
 *   3. Did legacy produce a prelim on that file anyway?
 *
 * NO WRITES AND NO VENDOR CALLS. Every statement below is a SELECT. TitlePoint
 * is billable and is not contacted — "was anything sent" is answered from our
 * own request log, not by asking them.
 *
 * Committed rather than run ad hoc (EVIDENCE_RULES.md rule 6): the numbers this
 * produces are going to decide whether six clients are waiting, and a figure
 * that decides something needs a method somebody else can rerun.
 */
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, { max: 2, prepare: false });

const FILES = [
  '20022304-OCT', '20022303-GLT', '20022301-OCT',
  '20022294-OCT', '20022286-GLT', '20022288-OCT',
];

const line = (s = '─') => console.log(s.repeat(78));
const when = (d: Date | string | null) => (d ? new Date(d).toISOString().replace('T', ' ').slice(0, 16) : '—');

(async () => {
  const orders = await sql`
    SELECT o.id, o.file_number, o.created_at, o.operational_status, o.title_officer_id,
           t.full_name AS title_officer, p.address, p.city, o.sales_rep_id
    FROM orders o
    LEFT JOIN order_properties p ON p.order_id = o.id
    LEFT JOIN contacts t ON t.id = o.title_officer_id
    WHERE o.file_number = ANY(${FILES})
    ORDER BY o.file_number`;

  console.log(`\nFound ${orders.length} of ${FILES.length} orders.`);
  const missing = FILES.filter((f) => !orders.some((o) => o.file_number === f));
  if (missing.length) console.log(`NOT IN THE HUB AT ALL: ${missing.join(', ')}`);

  for (const o of orders) {
    line('═');
    console.log(`${o.file_number}   order #${o.id}   opened ${when(o.created_at as Date)}`);
    console.log(`  ${o.address ?? '(no address)'}${o.city ? `, ${o.city}` : ''}`);
    console.log(`  status: ${o.operational_status ?? '—'}   title officer: ${o.title_officer ?? 'NONE ASSIGNED'}`);

    // 1 + 2. Every TitlePoint request row we hold for this order. The absence
    //        of rows is the answer to "was anything ever sent".
    const tp = await sql`
      SELECT search_type, status, request_id, service_id, session_id, message, created_at, updated_at
      FROM title_point_data
      WHERE order_id = ${o.id as number} OR file_number = ${o.file_number as string}
      ORDER BY created_at`;
    console.log(`\n  TitlePoint requests: ${tp.length}`);
    for (const r of tp) {
      console.log(`    ${when(r.created_at as Date)}  ${String(r.search_type ?? '—').padEnd(18)} ${String(r.status ?? '—').padEnd(14)} req=${r.request_id ?? '—'}`);
      if (r.message) console.log(`        ${String(r.message).slice(0, 110)}`);
    }
    if (tp.length === 0) console.log('    NOTHING WAS EVER SENT — no request row exists for this order.');

    // The vendor call log, which records attempts even when no row was written.
    const calls = await sql`
      SELECT operation, success, http_status, error_category, created_at,
             left(coalesce(response_meta::text, ''), 120) AS detail
      FROM vendor_api_logs
      WHERE vendor ILIKE '%titlepoint%' AND (order_id = ${o.id as number})
      ORDER BY created_at`;
    console.log(`  TitlePoint call log rows: ${calls.length}`);
    for (const c of calls) {
      console.log(`    ${when(c.created_at as Date)}  ${String(c.operation).padEnd(26)} ok=${c.success} ${c.http_status ?? ''} ${c.error_category ?? ''}`);
    }

    // 3. Did a prelim land on the file anyway — by any route, including legacy?
    const docs = await sql`
      SELECT id, category, filename, status, created_at, is_synced_to_softpro
      FROM documents
      WHERE order_id = ${o.id as number}
      ORDER BY created_at`;
    const prelims = docs.filter((d) => /prelim|title.?report/i.test(`${d.category} ${d.filename}`));
    console.log(`  Documents on the file: ${docs.length}  (prelim-ish: ${prelims.length})`);
    for (const d of docs) {
      const flag = /prelim|title.?report/i.test(`${d.category} ${d.filename}`) ? ' <- PRELIM' : '';
      console.log(`    ${when(d.created_at as Date)}  ${String(d.category ?? '—').padEnd(16)} ${String(d.filename).slice(0, 44).padEnd(44)} ${d.status}${flag}`);
    }
    if (prelims.length === 0) console.log('    NO PRELIM ON THIS FILE.');
  }

  // ── Two things the per-order output raises ───────────────────────────────

  line('═');
  console.log('\nTHE FAILURES ARE NOT RANDOM — county access, by county\n');
  // "Service access is currently denied in the specified county" names the
  // account, not the order. If it clusters by county it is a credentials
  // problem and not six unlucky files.
  const byCounty = await sql`
    SELECT p.county, t.search_type, t.status, count(*) AS n,
           count(DISTINCT t.order_id) AS orders
    FROM title_point_data t
    JOIN order_properties p ON p.order_id = t.order_id
    WHERE t.created_at >= '2026-09-10' AND t.message ILIKE '%access is currently denied%'
    GROUP BY 1, 2, 3 ORDER BY 4 DESC LIMIT 12`;
  if (byCounty.length === 0) console.log('  (no access-denied messages in the period)');
  for (const r of byCounty) {
    console.log(`  ${String(r.county ?? '—').padEnd(18)} ${String(r.search_type).padEnd(16)} ${String(r.status).padEnd(10)} ${r.n} rows across ${r.orders} orders`);
  }

  console.log('\nTHE ORDER MARKED DUPLICATE — is the real file covered?\n');
  const dupes = orders.filter((o) => o.operational_status === 'duplicate');
  for (const d of dupes) {
    const twins = await sql`
      SELECT o.id, o.file_number, o.operational_status, o.created_at,
             (SELECT count(*) FROM documents dd
               WHERE dd.order_id = o.id AND (dd.category::text ILIKE '%prelim%' OR dd.filename ILIKE '%prelim%')) AS prelims
      FROM orders o
      JOIN order_properties p ON p.order_id = o.id
      WHERE lower(regexp_replace(coalesce(p.address, ''), '[^a-zA-Z0-9]', '', 'g'))
          = (SELECT lower(regexp_replace(coalesce(p2.address, ''), '[^a-zA-Z0-9]', '', 'g'))
               FROM order_properties p2 WHERE p2.order_id = ${d.id as number})
        AND o.id <> ${d.id as number}
      ORDER BY o.created_at`;
    console.log(`  ${d.file_number} (#${d.id}) is marked duplicate. Orders on the same address: ${twins.length}`);
    for (const t of twins) {
      console.log(`    ${String(t.file_number).padEnd(16)} #${t.id}  ${String(t.operational_status).padEnd(12)} opened ${when(t.created_at as Date)}  prelims: ${t.prelims}`);
    }
    if (twins.length === 0) console.log('    NO OTHER ORDER ON THAT ADDRESS — the duplicate mark has no twin.');
  }

  // "We handled it on the other file" is only true if the client can SEE the
  // other file. There is no duplicate_of/canonical_order column anywhere in the
  // schema (checked), and documents load strictly by documents.order_id —
  // src/lib/domain/orders/documents.ts:64-118 has no cross-order path. So a
  // client whose access is to the DUPLICATE sees an empty document list, and
  // nothing in the code can walk them to the kept file.
  console.log('\nCAN THE CLIENT ON THE DUPLICATE SEE THE KEPT FILE?\n');
  const dupeVisibility = await sql`
    WITH pair AS (
      SELECT o.id, o.file_number,
             lower(regexp_replace(coalesce(p.address, ''), '[^a-zA-Z0-9]', '', 'g')) AS addr
      FROM orders o JOIN order_properties p ON p.order_id = o.id
      WHERE o.file_number IN ('20022294-OCT', '20022293-OCT'))
    SELECT pair.file_number, pair.id,
           op.contact_id, c.full_name, c.email, op.role
    FROM pair
    LEFT JOIN order_parties op ON op.order_id = pair.id
    LEFT JOIN contacts c ON c.id = op.contact_id
    ORDER BY pair.file_number, c.full_name`;
  for (const r of dupeVisibility) {
    console.log(`  ${String(r.file_number).padEnd(16)} ${String(r.role ?? '(no parties)').padEnd(18)} ${String(r.full_name ?? '—').padEnd(26)} contact=${r.contact_id ?? '—'}`);
  }
  // Access is created_by OR an order_parties contact (client-scope.ts:29-41).
  const creators = await sql`
    SELECT file_number, created_by FROM orders
    WHERE file_number IN ('20022294-OCT', '20022293-OCT') ORDER BY file_number`;
  for (const r of creators) {
    console.log(`  ${String(r.file_number).padEnd(16)} created_by = ${r.created_by ?? '(null)'}`);
  }
  const onlyDupe = await sql`
    SELECT DISTINCT c.full_name, c.email
    FROM order_parties op
    JOIN contacts c ON c.id = op.contact_id
    JOIN orders o ON o.id = op.order_id
    WHERE o.file_number = '20022294-OCT'
      AND op.contact_id NOT IN (
        SELECT op2.contact_id FROM order_parties op2
        JOIN orders o2 ON o2.id = op2.order_id
        WHERE o2.file_number = '20022293-OCT' AND op2.contact_id IS NOT NULL)`;
  console.log(`\n  Parties on the duplicate who are NOT on the kept file: ${onlyDupe.length}`);
  for (const r of onlyDupe) console.log(`    ${r.full_name} <${r.email ?? 'no email'}>  ← sees an empty file`);
  if (onlyDupe.length === 0) console.log('    None — everyone on the duplicate can also reach the kept file.');

  // And the general case, since 20021874-GLT is the same shape.
  const dupeCorpus = await sql`
    SELECT count(*) AS dupes,
           count(*) FILTER (WHERE d.prelims = 0) AS without_prelim
    FROM orders o
    JOIN LATERAL (
      SELECT count(*) AS prelims FROM documents dd
      WHERE dd.order_id = o.id AND dd.status = 'active'
        AND (dd.category::text ILIKE '%prelim%' OR dd.filename ILIKE '%prelim%')
        AND dd.filename NOT ILIKE '%dnu%') d ON true
    WHERE o.operational_status = 'duplicate'
      AND o.created_at >= now() - interval '90 days'`;
  console.log(`\n  Duplicate-marked orders in the last 90 days: ${dupeCorpus[0].dupes}`);
  console.log(`  of which have no usable prelim of their own: ${dupeCorpus[0].without_prelim}`);

  // That 28/28 is expected — the work happens on the kept file. It only harms
  // a client if THEY are attached to the duplicate and not to the twin, so
  // that is what to count. 20022294 passed; the class is the question.
  // MATCH ON APN, NOT ADDRESS. The app's own duplicate detection is APN
  // equality (src/app/api/orders/check-duplicate/route.ts:32), so matching on
  // a normalised address answers a different question than the one the
  // operator was answering when they pressed the button. Address also drops
  // most of the population: only 9 of the 28 duplicates have a non-empty
  // address, against 26 with an APN.
  const stranded = await sql`
    WITH dupes AS (
      SELECT o.id, o.file_number, o.created_by, upper(trim(p.apn)) AS apn
      FROM orders o JOIN order_properties p ON p.order_id = o.id
      WHERE o.operational_status = 'duplicate' AND o.created_at >= now() - interval '90 days'
        AND coalesce(trim(p.apn), '') <> ''),
    twins AS (
      SELECT d.id AS dupe_id, o2.id AS twin_id
      FROM dupes d
      JOIN order_properties p2 ON upper(trim(p2.apn)) = d.apn
      JOIN orders o2 ON o2.id = p2.order_id AND o2.id <> d.id
                    AND o2.operational_status <> 'duplicate')
    SELECT d.file_number, d.id,
           (SELECT count(*) FROM twins w WHERE w.dupe_id = d.id) AS twin_count,
           (SELECT count(*) FROM order_parties op
             WHERE op.order_id = d.id AND op.contact_id IS NOT NULL
               AND op.contact_id NOT IN (
                 SELECT op2.contact_id FROM order_parties op2
                 JOIN twins w2 ON w2.twin_id = op2.order_id AND w2.dupe_id = d.id
                 WHERE op2.contact_id IS NOT NULL)) AS stranded_parties,
           (SELECT count(*) FROM twins w3
             JOIN documents dd ON dd.order_id = w3.twin_id AND dd.status = 'active'
             WHERE w3.dupe_id = d.id
               AND (dd.category::text ILIKE '%prelim%' OR dd.filename ILIKE '%prelim%')
               AND dd.filename NOT ILIKE '%dnu%') AS twin_prelims
    FROM dupes d ORDER BY 4 DESC, 1`;
  // A contact_id on an order is not a person who can log in. Access needs a
  // profiles row with role='client' whose contact_id matches
  // (client-scope.ts:28-41), so "sees an empty file" is only true for those.
  const realClients = await sql`
    WITH dupes AS (
      SELECT o.id, o.file_number, upper(trim(p.apn)) AS apn
      FROM orders o JOIN order_properties p ON p.order_id = o.id
      WHERE o.operational_status = 'duplicate' AND o.created_at >= now() - interval '90 days'
        AND coalesce(trim(p.apn), '') <> ''),
    twins AS (
      SELECT d.id AS dupe_id, o2.id AS twin_id
      FROM dupes d
      JOIN order_properties p2 ON upper(trim(p2.apn)) = d.apn
      JOIN orders o2 ON o2.id = p2.order_id AND o2.id <> d.id
                    AND o2.operational_status <> 'duplicate')
    SELECT d.file_number, c.full_name, c.email, pr.role
    FROM dupes d
    JOIN order_parties op ON op.order_id = d.id AND op.contact_id IS NOT NULL
    JOIN contacts c ON c.id = op.contact_id
    JOIN profiles pr ON pr.contact_id = op.contact_id AND pr.role = 'client'
    WHERE op.contact_id NOT IN (
      SELECT op2.contact_id FROM order_parties op2
      JOIN twins w ON w.twin_id = op2.order_id AND w.dupe_id = d.id
      WHERE op2.contact_id IS NOT NULL)`;
  console.log(`\n  ...of which are a LOGIN-CAPABLE client (profiles.role='client'): ${realClients.length}`);
  for (const r of realClients) {
    console.log(`    ${String(r.file_number).padEnd(16)} ${r.full_name} <${r.email ?? 'no email'}>`);
  }
  if (realClients.length === 0) {
    console.log('    None. The stranded contacts have no portal login, so nobody is');
    console.log('    staring at an empty page today — but nothing prevents it either.');
  }

  const noTwin = stranded.filter((r) => Number(r.twin_count) === 0);
  const withStranded = stranded.filter((r) => Number(r.stranded_parties) > 0);
  const twinNoPrelim = stranded.filter((r) => Number(r.twin_count) > 0 && Number(r.twin_prelims) === 0);
  console.log(`\n  Of ${stranded.length} duplicates carrying an APN (of ${dupeCorpus[0].dupes} total):`);
  console.log(`    no same-address twin at all:        ${noTwin.length}  ← "duplicate of what?"`);
  console.log(`    twin exists but has no prelim:      ${twinNoPrelim.length}  ← nobody is covered`);
  console.log(`    have a party NOT on the twin:       ${withStranded.length}  ← latent only; see login check above`);
  for (const r of [...withStranded, ...noTwin, ...twinNoPrelim].slice(0, 12)) {
    console.log(`      ${String(r.file_number).padEnd(16)} twins=${r.twin_count} twin_prelims=${r.twin_prelims} stranded_parties=${r.stranded_parties}`);
  }

  console.log('\nIS "DNU" A CONVENTION OR A ONE-OFF?\n');
  // 20022304-OCT's only prelim is named "Preliminary Title Report - DNU". If
  // DNU means do-not-use, that file has no usable prelim and the count is one
  // lower. Whether it is a house convention decides that, so ask the corpus.
  const dnu = await sql`
    SELECT count(*) AS n, count(DISTINCT order_id) AS orders,
           min(created_at) AS first, max(created_at) AS last
    FROM documents WHERE filename ILIKE '%DNU%'`;
  console.log(`  Documents with DNU in the name: ${dnu[0].n} across ${dnu[0].orders} orders`);
  console.log(`  First ${when(dnu[0].first as Date)}, most recent ${when(dnu[0].last as Date)}`);
  const dnuSample = await sql`
    SELECT o.file_number, d.filename, d.created_at,
           (SELECT count(*) FROM documents d2 WHERE d2.order_id = d.order_id
              AND d2.filename ILIKE '%prelim%' AND d2.filename NOT ILIKE '%DNU%') AS other_prelims
    FROM documents d JOIN orders o ON o.id = d.order_id
    WHERE d.filename ILIKE '%DNU%' ORDER BY d.created_at DESC LIMIT 8`;
  for (const r of dnuSample) {
    console.log(`    ${when(r.created_at as Date)}  ${String(r.file_number).padEnd(16)} ${String(r.filename).slice(0, 46).padEnd(46)} other prelims on file: ${r.other_prelims}`);
  }

  line('═');
  await sql.end();
})().catch((e) => { console.error('FAILED:', String(e).slice(0, 400)); process.exit(1); });
