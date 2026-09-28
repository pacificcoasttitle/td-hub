/**
 * READ-ONLY. Does a TitlePoint tax search that returns nothing still create a
 * billable search?
 *
 * WHAT THIS CAN AND CANNOT ANSWER — read this before using the output.
 *
 * Nothing in this database records a TitlePoint charge. There is no cost
 * column, no invoice table, no credit counter for TitlePoint anywhere in the
 * schema; concierge_profiles.sitex_credits_charged is SiteX only. So this
 * script CANNOT tell you what we were billed. Only an invoice can.
 *
 * What it can do is establish whether a BILLABLE ARTIFACT was ever created.
 * TitlePoint's unit of work is a request: create_service returns a requestId,
 * and that requestId is what a line on the bill reconciles to. A failure that
 * never produced a requestId never produced anything for TitlePoint to
 * charge for. A failure that DID produce one is a search they ran, and the
 * prior is that a search they ran is a search they bill.
 *
 * That distinction is the decision, because the two failure modes differ:
 *
 *   denied county   — create_service itself is refused. If no requestId is
 *                     ever issued, ticking the box in Mono cannot be billed,
 *                     and refusing those counties up front is unnecessary.
 *   no tax record   — the search runs and comes back empty. A requestId
 *                     exists. That is the case likely to cost for a miss.
 *
 * NO VENDOR CALLS. TitlePoint is billable and is not contacted.
 *
 * Committed per EVIDENCE_RULES.md rule 6 — this decides whether we sell a
 * customer a charge we expect to return nothing.
 */
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, { max: 2, prepare: false });
const line = (s = '─') => console.log(s.repeat(78));

/** A requestId that means "TitlePoint issued us a search". '0' and '' do not. */
const REAL_REQUEST = sql`
  t.request_id IS NOT NULL AND trim(t.request_id) <> '' AND trim(t.request_id) <> '0'`;

(async () => {
  // ── 1. By outcome: was a request ever issued? ────────────────────────────
  line('═');
  console.log('\nTAX SEARCHES BY OUTCOME — was a TitlePoint request ever issued?\n');

  const byOutcome = await sql`
    SELECT
      CASE
        WHEN t.message ILIKE '%access is currently denied%' THEN 'county access denied'
        WHEN t.message ILIKE '%No document data%'           THEN 'no document data'
        WHEN t.message ILIKE '%Poll returned Failed%'       THEN 'poll returned failed'
        WHEN t.message ILIKE '%timeout%'                    THEN 'request timeout'
        WHEN t.status = 'completed'                          THEN 'completed'
        ELSE coalesce(t.status, '(no status)')
      END AS outcome,
      count(*) AS rows,
      count(*) FILTER (WHERE ${REAL_REQUEST}) AS with_request,
      count(*) FILTER (WHERE NOT (${REAL_REQUEST})) AS without_request
    FROM title_point_data t
    WHERE t.search_type = 'tax'
    GROUP BY 1 ORDER BY 2 DESC`;

  console.log(`  ${'Outcome'.padEnd(24)} ${'Rows'.padEnd(7)} ${'Got requestId'.padEnd(15)} None`);
  for (const r of byOutcome) {
    console.log(`  ${String(r.outcome).padEnd(24)} ${String(r.rows).padEnd(7)} ${String(r.with_request).padEnd(15)} ${r.without_request}`);
  }
  console.log('\n  A row with no requestId is a search TitlePoint never issued.');

  // ── 2. The denied counties specifically ──────────────────────────────────
  line('═');
  console.log('\nDENIED COUNTIES — is the refusal before or after a request exists?\n');

  const denied = await sql`
    SELECT count(*) AS rows,
           count(*) FILTER (WHERE ${REAL_REQUEST}) AS with_request,
           count(DISTINCT t.session_id) FILTER (WHERE t.session_id IS NOT NULL) AS sessions
    FROM title_point_data t
    WHERE t.search_type = 'tax' AND t.message ILIKE '%access is currently denied%'`;
  console.log(`  Denied tax rows: ${denied[0].rows}`);
  console.log(`  ...that carry a real requestId: ${denied[0].with_request}`);

  // The call log is the other half: if create_service itself failed, nothing
  // was ever created to bill for. If create_service SUCCEEDED and the denial
  // came later, a request existed.
  // v.request_id is OUR correlation id, set on every call whether or not
  // TitlePoint issued anything — counting it answers nothing. TitlePoint's own
  // id is tpRequestId inside response_meta (see titlepoint/mocks.ts:16 and
  // client.ts:476), and that is the one that means a search exists.
  const deniedCalls = await sql`
    SELECT v.operation, v.success, v.error_category, count(*) AS n,
           count(*) FILTER (
             WHERE coalesce(v.response_meta->>'tpRequestId', '') NOT IN ('', '0')
           ) AS with_tp_request
    FROM vendor_api_logs v
    WHERE v.vendor ILIKE '%titlepoint%'
      AND v.order_id IN (
        SELECT DISTINCT t.order_id FROM title_point_data t
        WHERE t.message ILIKE '%access is currently denied%' AND t.order_id IS NOT NULL)
    GROUP BY 1, 2, 3 ORDER BY 4 DESC LIMIT 12`;
  console.log('\n  Call log on denied orders — where in the sequence it stops:\n');
  console.log(`    ${'Operation'.padEnd(28)} ${'ok'.padEnd(6)} ${'Category'.padEnd(16)} ${'Calls'.padEnd(7)} TP req issued`);
  for (const r of deniedCalls) {
    console.log(`    ${String(r.operation).padEnd(28)} ${String(r.success).padEnd(6)} ${String(r.error_category ?? '—').padEnd(16)} ${String(r.n).padEnd(7)} ${r.with_tp_request}`);
  }

  // ── 3. Empty results: the search ran and found nothing ───────────────────
  line('═');
  console.log('\nSEARCHES THAT RAN AND RETURNED NOTHING\n');
  console.log('  These are the ones that should be expected to bill: TitlePoint did the');
  console.log('  work, the parcel simply had no record.\n');

  const empty = await sql`
    SELECT
      CASE WHEN t.message ILIKE '%No document data%' THEN 'no document data'
           ELSE left(coalesce(t.message, '(none)'), 44) END AS message,
      t.search_type,
      count(*) AS rows,
      count(*) FILTER (WHERE ${REAL_REQUEST}) AS with_request
    FROM title_point_data t
    WHERE t.status = 'failed'
      AND t.message NOT ILIKE '%access is currently denied%'
    GROUP BY 1, 2 HAVING count(*) >= 2 ORDER BY 3 DESC LIMIT 12`;
  console.log(`  ${'Message'.padEnd(46)} ${'Search'.padEnd(14)} ${'Rows'.padEnd(6)} With req`);
  for (const r of empty) {
    console.log(`  ${String(r.message).padEnd(46)} ${String(r.search_type).padEnd(14)} ${String(r.rows).padEnd(6)} ${r.with_request}`);
  }

  // ── 4. What would settle it ──────────────────────────────────────────────
  line('═');
  console.log('\nWHAT THIS DOES NOT SETTLE\n');
  const anyCost = await sql`
    SELECT count(*) AS n FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (column_name ILIKE '%titlepoint%cost%' OR column_name ILIKE '%tp_cost%'
           OR column_name ILIKE '%titlepoint%charge%' OR column_name ILIKE '%titlepoint%credit%')`;
  console.log(`  Columns recording a TitlePoint charge: ${anyCost[0].n}`);
  console.log('  We do not record what TitlePoint bills. The structural evidence above');
  console.log('  is a strong prior, not a reconciliation.');
  console.log('\n  To settle it: take one TitlePoint invoice and match its line items');
  console.log('  against the requestIds in title_point_data for the same period. If');
  console.log('  denied-county attempts appear as lines, they bill. If they do not, they');
  console.log('  do not. That is a half-hour once and it is permanent.');

  const reconcilable = await sql`
    SELECT count(*) AS n, min(created_at)::date AS since
    FROM title_point_data
    WHERE search_type = 'tax' AND request_id IS NOT NULL
      AND trim(request_id) NOT IN ('', '0')`;
  console.log(`\n  RequestIds available to reconcile against: ${reconcilable[0].n}, from ${reconcilable[0].since}`);

  line('═');
  await sql.end();
})().catch((e) => { console.error('FAILED:', String(e).slice(0, 500)); process.exit(1); });
