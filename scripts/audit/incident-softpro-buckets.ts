/**
 * INCIDENT, READ ONLY. The degradation curve: SoftPro calls per five minutes,
 * how many failed, the slowest one, and what the failures said.
 *
 * The timeline script showed the last 40 calls. This shows the SHAPE — whether
 * the adapter fell over at an instant or degraded first, and whether the
 * failures are timeouts (accepting connections, not answering) or connection
 * errors (not accepting at all). Those are different faults with different
 * owners.
 *
 *   npx tsx --env-file=.env.local scripts/audit/incident-softpro-buckets.ts [hours]
 */
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';

const hours = Number.isFinite(Number(process.argv[2])) && Number(process.argv[2]) > 0
  ? Number(process.argv[2]) : 12;

async function main() {
  console.log(`\nnow: ${new Date().toISOString()}\n`);

  const buckets = await db.execute(sql`
    select to_char(date_trunc('hour', created_at)
             + floor(extract(minute from created_at) / 5) * interval '5 minutes',
           'MM-DD HH24:MI')                                        as slot,
           count(*)                                                as calls,
           count(*) filter (where not success)                     as failed,
           max(extract(epoch from (ended_at - started_at)) * 1000)::int as slowest_ms,
           count(*) filter (where response_meta->>'error' ilike '%fetch failed%')  as conn_errors,
           count(*) filter (where error_category = 'timeout')      as timeouts,
           count(*) filter (where operation = 'create_order')      as creates,
           count(*) filter (where operation = 'create_order' and not success) as creates_failed
      from vendor_api_logs
     where vendor = 'softpro'
       and created_at >= now() - interval '${sql.raw(String(hours))} hours'
     group by 1
     order by 1`);

  const rows = (buckets as unknown as { rows?: Record<string, unknown>[] }).rows ?? (buckets as unknown as Record<string, unknown>[]);

  console.log('  slot            calls  fail  slowest   conn  t/o  creates(f)');
  for (const r of rows) {
    const n = Number(r.calls);
    const f = Number(r.failed);
    const bar = f === 0 ? '' : f === n ? '  <-- ALL FAILED' : '';
    console.log(
      `  ${String(r.slot)}  ${String(n).padStart(5)} ${String(f).padStart(5)} `
      + `${String(r.slowest_ms ?? '?').padStart(8)}ms ${String(r.conn_errors).padStart(5)} `
      + `${String(r.timeouts).padStart(4)}  ${String(r.creates)}(${String(r.creates_failed)})${bar}`,
    );
  }

  // What the failures actually SAY, grouped. "fetch failed" and a 120s timeout
  // are different faults: refused versus accepted-and-silent.
  const msgs = await db.execute(sql`
    select coalesce(response_meta->>'error', error_category, '(none)') as msg,
           count(*) as n,
           min(created_at) as first_seen,
           max(created_at) as last_seen
      from vendor_api_logs
     where vendor = 'softpro'
       and not success
       and created_at >= now() - interval '${sql.raw(String(hours))} hours'
     group by 1
     order by n desc
     limit 15`);
  const mrows = (msgs as unknown as { rows?: Record<string, unknown>[] }).rows ?? (msgs as unknown as Record<string, unknown>[]);

  console.log('\n  === what the failures said ===');
  for (const m of mrows) {
    const first = String(m.first_seen).slice(5, 19);
    const last = String(m.last_seen).slice(5, 19);
    console.log(`  ${String(m.n).padStart(5)}x  ${first} → ${last}  ${String(m.msg).slice(0, 90)}`);
  }

  // The last create_order that WORKED. The business question is when order
  // entry through the hub last functioned.
  const lastCreate = await db.execute(sql`
    select created_at, success, error_category,
           (extract(epoch from (ended_at - started_at)) * 1000)::int as ms
      from vendor_api_logs
     where vendor = 'softpro' and operation = 'create_order'
     order by created_at desc
     limit 8`);
  const crows = (lastCreate as unknown as { rows?: Record<string, unknown>[] }).rows ?? (lastCreate as unknown as Record<string, unknown>[]);

  console.log('\n  === the last 8 create_order calls, newest first ===');
  for (const c of crows) {
    console.log(
      `  ${String(c.created_at).slice(0, 19)}  ${c.success ? 'ok  ' : 'FAIL'}  `
      + `${String(c.ms ?? '?').padStart(7)}ms  ${String(c.error_category ?? '')}`,
    );
  }
  console.log('');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
