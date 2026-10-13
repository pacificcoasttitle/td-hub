/**
 * INCIDENT, READ ONLY. No orders can be created through the hub;
 * CREATE_TIMEOUT_LOOKUP_FAILED on the SoftPro create and on the follow-up
 * GetOrderDetails.
 *
 * Answers two of the three questions: when did the first failure happen, and
 * is EVERY SoftPro call failing or only creates. Writes nothing and calls no
 * vendor.
 *
 *   npx tsx --env-file=.env.local scripts/audit/incident-softpro-timeline.ts [hours]
 */
import { and, asc, gte, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { vendorApiLogs } from '@/lib/db/schema/integrations';

const hours = Number.isFinite(Number(process.argv[2])) && Number(process.argv[2]) > 0
  ? Number(process.argv[2]) : 3;

async function main() {
  const since = new Date(Date.now() - hours * 3600_000);

  const rows = await db
    .select({
      createdAt: vendorApiLogs.createdAt,
      startedAt: vendorApiLogs.startedAt,
      endedAt: vendorApiLogs.endedAt,
      operation: vendorApiLogs.operation,
      success: vendorApiLogs.success,
      errorCategory: vendorApiLogs.errorCategory,
      responseMeta: vendorApiLogs.responseMeta,
    })
    .from(vendorApiLogs)
    .where(and(eq(vendorApiLogs.vendor, 'softpro'), gte(vendorApiLogs.createdAt, since)))
    .orderBy(asc(vendorApiLogs.createdAt));

  const iso = (d: unknown) => (d instanceof Date ? d.toISOString().slice(11, 19) : String(d).slice(11, 19));
  const ms = (r: { startedAt: unknown; endedAt: unknown }) => {
    const a = r.startedAt instanceof Date ? r.startedAt.getTime() : NaN;
    const b = r.endedAt instanceof Date ? r.endedAt.getTime() : NaN;
    return Number.isFinite(a) && Number.isFinite(b) ? b - a : null;
  };

  console.log(`\n=== softpro, last ${hours}h — ${rows.length} call(s) ===\n`);
  if (rows.length === 0) {
    console.log('  NOTHING LOGGED. Either no traffic, or the failures are not reaching logRequest.');
  }

  // Per operation: how many, how many failed, and the duration spread. The
  // question "every call or only creates" is answered by this table.
  interface OpStats { n: number; fail: number; cats: Map<string, number>; durs: number[] }
  const byOp = new Map<string, OpStats>();
  for (const r of rows) {
    const e: OpStats = byOp.get(r.operation)
      ?? { n: 0, fail: 0, cats: new Map<string, number>(), durs: [] };
    e.n += 1;
    if (!r.success) {
      e.fail += 1;
      const c = r.errorCategory ?? '(none)';
      e.cats.set(c, (e.cats.get(c) ?? 0) + 1);
    }
    const d = ms(r);
    if (d !== null) e.durs.push(d);
    byOp.set(r.operation, e);
  }

  console.log('  operation                        calls  failed  durations(ms) min/median/max');
  for (const [op, e] of [...byOp].sort((a, b) => b[1].n - a[1].n)) {
    const s = e.durs.slice().sort((a, b) => a - b);
    const q = s.length > 0
      ? `${s[0]} / ${s[Math.floor(s.length / 2)]} / ${s[s.length - 1]}`
      : '—';
    console.log(`  ${op.padEnd(32)} ${String(e.n).padStart(5)}  ${String(e.fail).padStart(6)}  ${q}`);
    for (const [c, n] of [...e.cats].sort((a, b) => b[1] - a[1])) {
      console.log(`      ${n}x ${c}`);
    }
  }

  // THE FIRST FAILURE, and the last success before it. That boundary is the
  // window to compare against a deploy.
  const firstFail = rows.find((r) => !r.success);
  const lastOk = [...rows].reverse().find((r) => r.success);
  console.log('\n  === boundary ===');
  if (firstFail) {
    console.log(`  first failure in window : ${iso(firstFail.createdAt)}  ${firstFail.operation}  ${firstFail.errorCategory ?? ''}`);
  } else {
    console.log('  no failures in window');
  }
  if (lastOk) {
    console.log(`  LAST SUCCESS            : ${iso(lastOk.createdAt)}  ${lastOk.operation}  (${ms(lastOk) ?? '?'}ms)`);
  } else {
    console.log('  NO SUCCESSFUL SoftPro CALL IN THE WINDOW AT ALL');
  }

  // The last 40 calls in order. A pattern — creates failing while reads
  // succeed, or everything timing out at the same duration — is visible here
  // and not in the aggregate.
  console.log('\n  === last 40, in order ===');
  for (const r of rows.slice(-40)) {
    const d = ms(r);
    const rm = (r.responseMeta ?? {}) as Record<string, unknown>;
    const detail = [
      rm.status ?? rm.httpStatus ?? '',
      typeof rm.error === 'string' ? rm.error.slice(0, 70) : '',
    ].filter(Boolean).join(' ');
    console.log(
      `  ${iso(r.createdAt)}  ${r.success ? 'ok  ' : 'FAIL'}  ${String(d ?? '?').padStart(6)}ms  `
      + `${r.operation.padEnd(28)} ${(r.errorCategory ?? '').padEnd(26)} ${detail}`,
    );
  }
  console.log('');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
