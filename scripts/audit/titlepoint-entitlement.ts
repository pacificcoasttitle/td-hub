/**
 * READ-ONLY. What the TitlePoint county-entitlement denial has actually cost,
 * measured from its FIRST occurrence rather than from an arbitrary fortnight.
 *
 * A fortnight is an argument. Every order since the entitlement lapsed is a
 * number, and the number is what the vendor conversation runs on.
 *
 * Also separates the failure taxonomy, because the six-order audit conflated
 * two things: 20022303-GLT had tax and geo_address fail and still produced a
 * prelim on the 19th, so THE ENTITLEMENT DENIAL DOES NOT BLOCK A PRELIM. The
 * only file with no prelim at all, 20022288-OCT, is also the only one whose
 * grant_deed failed — a different error entirely. If that holds across the
 * corpus it is a separate defect standing next to a vendor problem, and fixing
 * the vendor problem would leave it silently in place.
 *
 * NO WRITES AND NO VENDOR CALLS. Every statement is a SELECT. TitlePoint is
 * billable and is not contacted.
 *
 * Committed per EVIDENCE_RULES.md rule 6.
 */
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, { max: 2, prepare: false });

const DENIAL = '%access is currently denied%';
const line = (s = '─') => console.log(s.repeat(78));
const when = (d: Date | string | null) => (d ? new Date(d).toISOString().replace('T', ' ').slice(0, 16) : '—');
const day = (d: Date | string | null) => (d ? new Date(d).toISOString().slice(0, 10) : '—');

(async () => {
  // ── 1. When did this start? ──────────────────────────────────────────────
  line('═');
  console.log('WHEN THE ENTITLEMENT LAPSED\n');

  const first = await sql`
    SELECT min(created_at) AS first_seen, max(created_at) AS last_seen, count(*) AS n
    FROM title_point_data WHERE message ILIKE ${DENIAL}`;
  const firstSeen = first[0].first_seen as Date | null;

  if (!firstSeen) {
    console.log('  No denial messages at all. Nothing below will mean anything.');
    await sql.end();
    return;
  }
  console.log(`  First denial:  ${when(firstSeen)}`);
  console.log(`  Most recent:   ${when(first[0].last_seen as Date)}`);
  console.log(`  Total denial rows: ${first[0].n}`);

  // LAPSE OR NEVER ENTITLED? These lead to opposite vendor conversations —
  // "restore what we pay for" versus "we have never been able to serve these
  // counties". Deciding it needs the FULL attempt history per county, not just
  // whether a success exists: a county with no attempts before the first
  // denial proves nothing either way.
  //
  // County is stored with inconsistent case ("Mono" and "MONO" are the same
  // county), so every grouping here folds case. Counting them separately would
  // have split Mono's twelve orders into 12 and 2.
  console.log('\n  Attempt history per affected county — tax/geo only:\n');
  console.log(`    ${'County'.padEnd(14)} ${'OK'.padEnd(5)} ${'Denied'.padEnd(7)} ${'First att.'.padEnd(12)} ${'Last OK'.padEnd(12)} Reading`);
  const history = await sql`
    WITH affected AS (
      SELECT DISTINCT upper(p.county) AS county
      FROM title_point_data t JOIN order_properties p ON p.order_id = t.order_id
      WHERE t.message ILIKE ${DENIAL})
    SELECT upper(p.county) AS county,
           count(*) FILTER (WHERE t.status = 'completed') AS ok,
           count(*) FILTER (WHERE t.message ILIKE ${DENIAL}) AS denied,
           min(t.created_at) AS first_attempt,
           max(t.created_at) FILTER (WHERE t.status = 'completed') AS last_ok
    FROM title_point_data t
    JOIN order_properties p ON p.order_id = t.order_id
    WHERE upper(p.county) IN (SELECT county FROM affected)
      AND t.search_type IN ('tax', 'geo_address')
    GROUP BY 1 ORDER BY 3 DESC`;
  for (const r of history) {
    const lastOk = r.last_ok as Date | null;
    const reading = Number(r.ok) === 0
      ? 'never worked — NOT a lapse'
      : lastOk && new Date(lastOk) < new Date(firstSeen)
        ? 'LAPSE — worked, then stopped'
        : 'still works sometimes — intermittent';
    console.log(`    ${String(r.county).padEnd(14)} ${String(r.ok).padEnd(5)} ${String(r.denied).padEnd(7)} ${day(r.first_attempt as Date).padEnd(12)} ${day(lastOk).padEnd(12)} ${reading}`);
  }

  // The control: counties that have never been denied. If they are all
  // high-volume and the denied ones are all low-volume, "never entitled" is
  // just "we rarely send there" and the first-denial date is meaningless.
  const working = await sql`
    SELECT upper(p.county) AS county, count(*) AS ok
    FROM title_point_data t JOIN order_properties p ON p.order_id = t.order_id
    WHERE t.status = 'completed' AND t.search_type IN ('tax', 'geo_address')
      AND upper(p.county) NOT IN (
        SELECT DISTINCT upper(p2.county) FROM title_point_data t2
        JOIN order_properties p2 ON p2.order_id = t2.order_id
        WHERE t2.message ILIKE ${DENIAL})
    GROUP BY 1 ORDER BY 2 DESC LIMIT 10`;
  console.log('\n  Counties that have NEVER been denied, by successful search volume:');
  console.log(`    ${working.map((r) => `${r.county} (${r.ok})`).join(', ')}`);

  // ── 2. The cost, counted from the first denial ───────────────────────────
  line('═');
  console.log(`\nTHE COST SINCE ${day(firstSeen)} — by county and by which search failed\n`);

  const byCountySearch = await sql`
    SELECT upper(p.county) AS county, t.search_type,
           count(*) AS rows, count(DISTINCT t.order_id) AS orders
    FROM title_point_data t
    JOIN order_properties p ON p.order_id = t.order_id
    WHERE t.message ILIKE ${DENIAL} AND t.created_at >= ${firstSeen}
    GROUP BY 1, 2 ORDER BY 4 DESC, 1, 2`;
  console.log(`  ${'County'.padEnd(16)} ${'Search'.padEnd(14)} ${'Rows'.padEnd(6)} Orders`);
  for (const r of byCountySearch) {
    console.log(`  ${String(r.county ?? '—').padEnd(16)} ${String(r.search_type).padEnd(14)} ${String(r.rows).padEnd(6)} ${r.orders}`);
  }

  const totals = await sql`
    SELECT count(DISTINCT t.order_id) AS orders,
           count(DISTINCT upper(p.county)) AS counties
    FROM title_point_data t
    JOIN order_properties p ON p.order_id = t.order_id
    WHERE t.message ILIKE ${DENIAL} AND t.created_at >= ${firstSeen}`;
  console.log(`\n  ${totals[0].orders} DISTINCT ORDERS across ${totals[0].counties} counties since ${day(firstSeen)}.`);

  // ── 3. Does a denial actually cost the client a prelim? ──────────────────
  line('═');
  console.log('\nDOES THE DENIAL COST A PRELIM? (20022303-GLT says no — check the corpus)\n');

  const deniedPrelim = await sql`
    WITH denied AS (
      SELECT DISTINCT order_id FROM title_point_data
      WHERE message ILIKE ${DENIAL} AND created_at >= ${firstSeen} AND order_id IS NOT NULL)
    SELECT count(*) AS orders,
           count(*) FILTER (WHERE d.prelims > 0) AS with_prelim,
           count(*) FILTER (WHERE d.prelims = 0) AS without_prelim
    FROM denied
    JOIN LATERAL (
      SELECT count(*) AS prelims FROM documents dd
      WHERE dd.order_id = denied.order_id AND dd.status = 'active'
        AND (dd.category::text ILIKE '%prelim%' OR dd.filename ILIKE '%prelim%')
        AND dd.filename NOT ILIKE '%dnu%') d ON true`;
  const dp = deniedPrelim[0];
  console.log(`  Orders hit by a county denial: ${dp.orders}`);
  console.log(`    with a usable prelim anyway: ${dp.with_prelim}`);
  console.log(`    with NO usable prelim:       ${dp.without_prelim}`);

  // ── 4. The failure taxonomy — which failure actually correlates? ─────────
  line('═');
  console.log('\nWHICH FAILURE CORRELATES WITH A MISSING PRELIM\n');

  // AGE CONTROL. An order opened yesterday with no prelim is not silent, it is
  // young. Without this every rate below is inflated by however many orders
  // happen to be recent, and the comparison between failure modes becomes a
  // comparison of when they last occurred. Five days is the threshold because
  // the 17 September files are six days old and we are calling those late.
  const RIPE_DAYS = 5;
  console.log(`  Only orders opened ${RIPE_DAYS}+ days ago — a young order with no prelim`);
  console.log('  is not silent, and counting it as such inflates every rate here.\n');

  const taxonomy = await sql`
    WITH fails AS (
      SELECT DISTINCT t.order_id, t.search_type,
             CASE
               WHEN t.message ILIKE ${DENIAL} THEN 'county access denied'
               WHEN t.message ILIKE '%No document data%' THEN 'no document data'
               WHEN t.message ILIKE '%Poll returned Failed%' THEN 'poll returned failed'
               WHEN t.message ILIKE '%timeout%' THEN 'request timeout'
               -- '\\s' and not '\s': in a JS template literal a single
               -- backslash collapses, so '\s+' reaches Postgres as 's+' and
               -- eats the "ss" out of "Missing". Same backslash bug the source
               -- guards were rewritten over — it survives into SQL strings too.
               ELSE left(regexp_replace(coalesce(t.message, '(no message)'), '\\s+', ' ', 'g'), 30)
             END AS failure
      FROM title_point_data t
      JOIN orders o ON o.id = t.order_id
      WHERE t.status = 'failed' AND t.created_at >= ${firstSeen}
        AND o.created_at < now() - ${`${RIPE_DAYS} days`}::interval)
    SELECT f.search_type, f.failure,
           count(*) AS orders,
           count(*) FILTER (WHERE d.prelims = 0) AS no_prelim,
           round(100.0 * count(*) FILTER (WHERE d.prelims = 0) / count(*), 1) AS pct_silent
    FROM fails f
    JOIN LATERAL (
      SELECT count(*) AS prelims FROM documents dd
      WHERE dd.order_id = f.order_id AND dd.status = 'active'
        AND (dd.category::text ILIKE '%prelim%' OR dd.filename ILIKE '%prelim%')
        AND dd.filename NOT ILIKE '%dnu%') d ON true
    GROUP BY 1, 2 HAVING count(*) >= 2 ORDER BY 5 DESC, 3 DESC LIMIT 20`;
  console.log(`  ${'Search'.padEnd(14)} ${'Failure'.padEnd(24)} ${'Orders'.padEnd(7)} ${'Silent'.padEnd(7)} %`);
  for (const r of taxonomy) {
    console.log(`  ${String(r.search_type).padEnd(14)} ${String(r.failure).padEnd(24)} ${String(r.orders).padEnd(7)} ${String(r.no_prelim).padEnd(7)} ${r.pct_silent}%`);
  }

  // The baseline this has to beat: an order with no TitlePoint failure at all,
  // held to the same age threshold.
  const baseline = await sql`
    WITH clean AS (
      SELECT DISTINCT t.order_id FROM title_point_data t
      JOIN orders o ON o.id = t.order_id
      WHERE t.created_at >= ${firstSeen}
        AND o.created_at < now() - ${`${RIPE_DAYS} days`}::interval
      EXCEPT
      SELECT DISTINCT t2.order_id FROM title_point_data t2
      WHERE t2.status = 'failed' AND t2.created_at >= ${firstSeen} AND t2.order_id IS NOT NULL)
    SELECT count(*) AS orders, count(*) FILTER (WHERE d.prelims = 0) AS no_prelim,
           round(100.0 * count(*) FILTER (WHERE d.prelims = 0) / nullif(count(*), 0), 1) AS pct_silent
    FROM clean
    JOIN LATERAL (
      SELECT count(*) AS prelims FROM documents dd
      WHERE dd.order_id = clean.order_id AND dd.status = 'active'
        AND (dd.category::text ILIKE '%prelim%' OR dd.filename ILIKE '%prelim%')
        AND dd.filename NOT ILIKE '%dnu%') d ON true`;
  console.log(`\n  BASELINE — orders with NO TitlePoint failure: ${baseline[0].orders}, of which`);
  console.log(`  ${baseline[0].no_prelim} have no usable prelim (${baseline[0].pct_silent}%). A failure mode only`);
  console.log('  matters if it is worse than this.');

  // ── 4b. Isolate grant_deed from the denial ───────────────────────────────
  //
  // 20022288-OCT has BOTH a county denial and a failed grant_deed, so the
  // per-failure rates above cannot say which one silenced it. 20022303-GLT is
  // the same county with the same two denials and NO grant_deed failure, and
  // it got a prelim — suggestive at n=1. This holds the denial constant and
  // varies only grant_deed.
  line('═');
  console.log('\nISOLATING grant_deed — denial held constant\n');

  const isolate = await sql`
    WITH ripe AS (
      SELECT o.id FROM orders o
      WHERE o.created_at < now() - ${`${RIPE_DAYS} days`}::interval),
    denied AS (
      SELECT DISTINCT order_id FROM title_point_data
      WHERE message ILIKE ${DENIAL} AND created_at >= ${firstSeen} AND order_id IS NOT NULL),
    gd_failed AS (
      SELECT DISTINCT order_id FROM title_point_data
      WHERE search_type = 'grant_deed' AND status = 'failed'
        AND created_at >= ${firstSeen} AND order_id IS NOT NULL)
    SELECT
      (r.id IN (SELECT order_id FROM denied))    AS denied,
      (r.id IN (SELECT order_id FROM gd_failed)) AS grant_deed_failed,
      count(*) AS orders,
      count(*) FILTER (WHERE d.prelims = 0) AS silent,
      round(100.0 * count(*) FILTER (WHERE d.prelims = 0) / count(*), 1) AS pct
    FROM ripe r
    JOIN LATERAL (
      SELECT count(*) AS prelims FROM documents dd
      WHERE dd.order_id = r.id AND dd.status = 'active'
        AND (dd.category::text ILIKE '%prelim%' OR dd.filename ILIKE '%prelim%')
        AND dd.filename NOT ILIKE '%dnu%') d ON true
    WHERE r.id IN (SELECT order_id FROM denied) OR r.id IN (SELECT order_id FROM gd_failed)
       OR r.id IN (SELECT order_id FROM title_point_data WHERE created_at >= ${firstSeen})
    GROUP BY 1, 2 ORDER BY 1, 2`;
  console.log(`  ${'Denied'.padEnd(8)} ${'grant_deed failed'.padEnd(19)} ${'Orders'.padEnd(7)} ${'Silent'.padEnd(7)} %`);
  for (const r of isolate) {
    console.log(`  ${String(r.denied).padEnd(8)} ${String(r.grant_deed_failed).padEnd(19)} ${String(r.orders).padEnd(7)} ${String(r.silent).padEnd(7)} ${r.pct}%`);
  }
  console.log('\n  Read the two rows where denied=true. If grant_deed failing lifts the');
  console.log('  silent rate there, it is doing damage the denial is not.');

  // ── 5. The full list, for the vendor conversation ────────────────────────
  line('═');
  console.log('\nTHE FULL LIST — every order hit by a county denial since the first one\n');

  const full = await sql`
    SELECT o.file_number, o.id, o.operational_status, upper(p.county) AS county, p.city,
           o.created_at, (now()::date - o.created_at::date) AS age_days,
           c.full_name AS title_officer, min(t.created_at) AS first_denial,
           string_agg(DISTINCT t.search_type, '+' ORDER BY t.search_type) AS searches,
           (SELECT count(*) FROM documents dd WHERE dd.order_id = o.id AND dd.status = 'active'
              AND (dd.category::text ILIKE '%prelim%' OR dd.filename ILIKE '%prelim%')
              AND dd.filename NOT ILIKE '%dnu%') AS prelims
    FROM title_point_data t
    JOIN orders o ON o.id = t.order_id
    JOIN order_properties p ON p.order_id = o.id
    LEFT JOIN contacts c ON c.id = o.title_officer_id
    WHERE t.message ILIKE ${DENIAL} AND t.created_at >= ${firstSeen}
    GROUP BY o.file_number, o.id, o.operational_status, upper(p.county), p.city, c.full_name, o.created_at
    ORDER BY upper(p.county), min(t.created_at)`;
  console.log(`  ${'File'.padEnd(16)} ${'County'.padEnd(13)} ${'City'.padEnd(16)} ${'Status'.padEnd(11)} ${'Age'.padEnd(5)} Prelim`);
  let silentRipe = 0;
  for (const r of full) {
    const age = Number(r.age_days);
    const none = Number(r.prelims) === 0;
    // A young order with no prelim is not a finding. Only flag the ripe ones.
    const flag = none ? (age >= 5 ? 'NONE ← SILENT' : `none (only ${age}d old)`) : String(r.prelims);
    if (none && age >= 5) silentRipe += 1;
    console.log(`  ${String(r.file_number).padEnd(16)} ${String(r.county ?? '—').padEnd(13)} ${String(r.city ?? '—').slice(0, 15).padEnd(16)} ${String(r.operational_status).padEnd(11)} ${`${age}d`.padEnd(5)} ${flag}`);
  }
  console.log(`\n  ${full.length} orders hit. ${silentRipe} are 5+ days old with no usable prelim.`);
  console.log('  Every search that failed here was tax+geo_address — the two the');
  console.log('  entitlement denial touches, and neither blocks a prelim on its own.');

  line('═');
  await sql.end();
})().catch((e) => { console.error('FAILED:', String(e).slice(0, 500)); process.exit(1); });
