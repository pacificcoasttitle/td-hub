/**
 * READ-ONLY. Is the zip backfill still outstanding?
 *
 * An uncommitted one-shot, scripts/audit/reenrich-zip-only.ts, sat in the tree
 * from 28 August writing zip onto "~35 open/in-process rows that already have
 * an address and no zip". It was never committed anywhere — which is itself
 * against the rule that nothing writing to production runs from uncommitted
 * code — and it broke `npm run typecheck:scripts`, so the whole verify gate
 * could not go green.
 *
 * Deleting it needed one fact first: whether the rows it was written for are
 * still missing a zip. If they are, the work has an owner even though the file
 * does not.
 *
 * NO WRITES AND NO VENDOR CALLS. This only counts rows.
 */
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });

(async () => {
  const rows = await sql`
    SELECT o.operational_status,
           count(*) AS n,
           count(*) FILTER (WHERE coalesce(trim(p.zip), '') = '') AS no_zip,
           count(*) FILTER (WHERE coalesce(trim(p.zip), '') = ''
                              AND coalesce(trim(p.address), '') <> '') AS no_zip_with_address
    FROM orders o
    JOIN order_properties p ON p.order_id = o.id
    WHERE o.operational_status IN ('open', 'in_process')
    GROUP BY 1 ORDER BY 2 DESC`;

  console.log(`\n  ${'status'.padEnd(14)} ${'rows'.padEnd(8)} ${'no zip'.padEnd(8)} no zip + has address`);
  let outstanding = 0;
  for (const r of rows) {
    console.log(`  ${String(r.operational_status).padEnd(14)} ${String(r.n).padEnd(8)} ${String(r.no_zip).padEnd(8)} ${r.no_zip_with_address}`);
    outstanding += Number(r.no_zip_with_address);
  }

  console.log(`\n  Open/in-process orders with an address and no zip: ${outstanding}`);
  if (outstanding === 0) {
    console.log('  The backfill is done. The script was dead code.');
  } else {
    console.log('  STILL OUTSTANDING. The work has an owner even if the file does not —');
    console.log('  and it needs a committed script, per the production-writes rule.');
  }

  // Age matters: rows created since the mapping change are a live defect, not a
  // backlog the one-shot was meant to clear.
  const recent = await sql`
    SELECT count(*) AS n
    FROM orders o JOIN order_properties p ON p.order_id = o.id
    WHERE o.operational_status IN ('open', 'in_process')
      AND coalesce(trim(p.zip), '') = '' AND coalesce(trim(p.address), '') <> ''
      AND o.created_at >= now() - interval '30 days'`;
  console.log(`  Of those, opened in the last 30 days: ${recent[0].n}`);
  if (Number(recent[0].n) > 0) {
    console.log('  New rows are still arriving without a zip, so this is not a backlog');
    console.log('  to clear once — something upstream is not setting it.');
  }

  await sql.end();
})().catch((e) => { console.error('FAILED:', String(e).slice(0, 400)); process.exit(1); });
