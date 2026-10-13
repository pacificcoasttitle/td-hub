/**
 * INCIDENT, READ ONLY. What the DEPLOYED FUNCTION has managed recently.
 *
 * Its own logged calls are the only evidence about the Vercel-to-adapter path.
 * A curl from a laptop proves the adapter is answering SOMEBODY; it takes a
 * different network route and says nothing about whether Vercel can reach it.
 *
 *   npx tsx --env-file=.env.local scripts/audit/incident-softpro-since.ts [minutes]
 */
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';

const mins = Number.isFinite(Number(process.argv[2])) && Number(process.argv[2]) > 0
  ? Number(process.argv[2]) : 30;

async function main() {
  console.log(`\nnow: ${new Date().toISOString()}   window: last ${mins} min\n`);

  const r = await db.execute(sql`
    select to_char(created_at, 'HH24:MI:SS')                         as at,
           operation, success, error_category,
           (extract(epoch from (ended_at - started_at)) * 1000)::int  as ms,
           response_meta->>'error'                                    as err
      from vendor_api_logs
     where vendor = 'softpro'
       and created_at >= now() - interval '${sql.raw(String(mins))} minutes'
     order by created_at desc
     limit 60`);
  const rows = (r as unknown as { rows?: Record<string, unknown>[] }).rows
    ?? (r as unknown as Record<string, unknown>[]);

  if (rows.length === 0) {
    console.log('  NO SoftPro CALLS AT ALL in the window.');
    console.log('  The deployed function has not tried since, so recovery is unproven from its side.');
  }
  for (const x of rows) {
    console.log(
      `  ${String(x.at)}  ${x.success ? 'ok  ' : 'FAIL'}  ${String(x.ms ?? '?').padStart(7)}ms  `
      + `${String(x.operation).padEnd(28)} ${String(x.error_category ?? '').padEnd(12)} `
      + `${String(x.err ?? '').slice(0, 50)}`,
    );
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
