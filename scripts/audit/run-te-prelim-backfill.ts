/**
 * One-shot T&E prelim ingest. Calls backfillTePrelimsWithoutDelivery,
 * which hardcodes deliver: false. Not wired to vercel.json.
 *
 *   npx tsx --env-file=.env.local scripts/audit/run-te-prelim-backfill.ts --limit 50
 *
 * TESSA is not invoked. Live softpro.fetch_prelims is untouched.
 *
 * PRODUCTION WRITES: this script can still be pointed at prod via
 * DATABASE_URL. It must be reviewed on a branch before any prod run.
 * First --limit 50, then STOP and report. Do not continue. Do not
 * default above 50. Uncommitted code does not write to production.
 */
import postgres from 'postgres';
import { backfillTePrelimsWithoutDelivery } from '../../src/lib/jobs/handlers/backfill-te-prelims';

function parseLimit(argv: string[]): number {
  const idx = argv.indexOf('--limit');
  if (idx === -1 || !argv[idx + 1]) return 50;
  const n = Number(argv[idx + 1]);
  if (!Number.isFinite(n) || n < 1) throw new Error(`invalid --limit ${argv[idx + 1]}`);
  return Math.floor(n);
}

async function deliveryCounts(sql: ReturnType<typeof postgres>, batchStart: Date) {
  const deliveredRows = await sql`
    select count(*)::int as n from admin_activity_logs
    where action = 'prelim_auto_delivery'
      and meta->>'outcome' = 'delivered'
      and created_at > ${batchStart}
  ` as unknown as Array<{ n: number }>;
  const prelimDeliveredRows = await sql`
    select count(*)::int as n from admin_activity_logs
    where action = 'prelim_delivered'
      and created_at > ${batchStart}
  ` as unknown as Array<{ n: number }>;
  const outcomes = await sql`
    select meta->>'outcome' as outcome, count(*)::int as n
    from admin_activity_logs
    where action = 'prelim_auto_delivery'
      and created_at > ${batchStart}
    group by 1
    order by 1
  ` as unknown as Array<{ outcome: string | null; n: number }>;
  return {
    autoDelivered: deliveredRows[0]?.n ?? 0,
    prelimDelivered: prelimDeliveredRows[0]?.n ?? 0,
    outcomes,
  };
}

async function remainingTeWithoutPrelim(sql: ReturnType<typeof postgres>): Promise<number> {
  const rows = await sql`
    select count(*)::int as n
    from orders o
    where o.order_type = 'Title & Escrow'
      and o.operational_status in ('open', 'in_process', 'completed')
      and not exists (
        select 1 from documents d
        where d.order_id = o.id and d.category = 'prelim' and d.status = 'active'
      )
  ` as unknown as Array<{ n: number }>;
  return rows[0]?.n ?? 0;
}

async function main() {
  const limit = parseLimit(process.argv.slice(2));
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  if (!process.env.SOFTPRO_API_URL) throw new Error('SOFTPRO_API_URL is not set');

  const sql = postgres(process.env.DATABASE_URL, { max: 2, prepare: false });
  const batchStart = new Date();
  console.log(JSON.stringify({
    event: 'te_prelim_backfill_start',
    limit,
    batchStart: batchStart.toISOString(),
    remainingBefore: await remainingTeWithoutPrelim(sql),
  }));

  const result = await backfillTePrelimsWithoutDelivery({ limit });
  const logs = await deliveryCounts(sql, batchStart);
  const remainingAfter = await remainingTeWithoutPrelim(sql);

  const report = {
    event: 'te_prelim_backfill_done',
    batchStart: batchStart.toISOString(),
    batchEnd: new Date().toISOString(),
    limit,
    eligible: result.eligible,
    attempted: result.attempted,
    stored: result.stored,
    skipped: result.skipped,
    errors: result.errors,
    fileNumbers: result.fileNumbers,
    adminActivity: {
      prelim_auto_delivery_delivered: logs.autoDelivered,
      prelim_delivered: logs.prelimDelivered,
      prelim_auto_delivery_outcomes: logs.outcomes,
    },
    remainingTeWithoutPrelim: remainingAfter,
  };
  console.log(JSON.stringify(report, null, 2));

  await sql.end();

  if (logs.autoDelivered > 0 || logs.prelimDelivered > 0) {
    console.error('STOP: delivery count > 0. Do not run the rest.');
    process.exit(2);
  }
  // The handler imports the app db client, which holds a pool open.
  // A one-shot must not sit on that handle after the report is printed.
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
