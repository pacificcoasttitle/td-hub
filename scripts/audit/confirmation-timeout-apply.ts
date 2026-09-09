/**
 * Re-derive the confirmation timeout from live data, then apply it.
 *
 * The 25-minute figure in the ticket came from a 90-day window measured on
 * 2026-09-08. This re-runs that measurement against whatever the data says
 * TODAY and prints the trade-off table before writing anything, so the value
 * that lands is the one the current distribution supports rather than a
 * number copied out of a document.
 *
 * Writes through `updateSetting` rather than an UPDATE: it owns the jsonb
 * typing (this key is type 'number', so a bare string would poison
 * `Number(raw)` for every reader) and it invalidates the 60s settings cache.
 *
 *   npx tsx --env-file=.env.local scripts/audit/confirmation-timeout-apply.ts          # report only
 *   npx tsx --env-file=.env.local scripts/audit/confirmation-timeout-apply.ts --apply
 */
import { db } from '../../src/lib/db/client';
import { sql } from 'drizzle-orm';
import { getSetting, updateSetting } from '../../src/lib/domain/settings/service';
import { scriptExit } from '../lib/script-exit';

const APPLY = process.argv.includes('--apply');
const KEY = 'open_order_confirmation_timeout_minutes';
const CANDIDATES = [10, 15, 20, 25, 30, 45, 60];

function pct(n: number, d: number): string {
  return d === 0 ? '—' : `${((n / d) * 100).toFixed(1)}%`;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

async function main() {
  // Duration of a legal-vesting search = row creation to the terminal update.
  // Only 'completed' rows: a 'failed' search releases the gate the moment it
  // fails, so its duration says nothing about how long the clock must wait.
  const rows = (await db.execute(sql`
    select extract(epoch from (updated_at - created_at)) / 60.0 as minutes
    from title_point_data
    where search_type = 'legal_vesting'
      and status = 'completed'
      and created_at >= now() - interval '90 days'
      and updated_at > created_at
    order by 1
  `)) as unknown as Array<{ minutes: string | number }>;

  const mins = rows.map((r) => Number(r.minutes)).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  const n = mins.length;

  console.log(`\nLEGAL VESTING DURATIONS — ${n} completed searches, last 90 days\n`);
  for (const q of [0.5, 0.75, 0.9, 0.95, 0.99]) {
    console.log(`  p${String(q * 100).padStart(2)}  ${quantile(mins, q).toFixed(1)} min`);
  }
  console.log(`  max  ${(mins[n - 1] ?? 0).toFixed(1)} min`);

  console.log(`\nTRADE-OFF — what each ceiling would have caught\n`);
  console.log('  ceiling   caught   still incomplete   of those, extra wait');
  for (const t of CANDIDATES) {
    const caught = mins.filter((m) => m <= t).length;
    const over = n - caught;
    console.log(
      `  ${String(t).padStart(3)} min   ${pct(caught, n).padStart(6)}   ${String(over).padStart(3)} of ${n}` +
      `          +${t - 10} min vs today`,
    );
  }

  // The answer to the question actually asked: smallest ceiling clearing 95%.
  const supported = CANDIDATES.find((t) => mins.filter((m) => m <= t).length / n >= 0.95);
  const caughtAt = supported ? pct(mins.filter((m) => m <= supported).length, n) : '—';
  console.log(`\n  → smallest ceiling catching 95%: ${supported ?? 'none under 60'} min (${caughtAt})`);

  const current = await getSetting(KEY);
  console.log(`\nSETTING  ${KEY}`);
  console.log(`  current: ${current}`);

  // Has the attachment record started landing? Proving the timeout change
  // worked depends on it, so report it in the same breath.
  const meta = (await db.execute(sql`
    select count(*) filter (where metadata is not null) as with_meta,
           count(*)                                    as total,
           min(sent_at) filter (where metadata is not null) as first_recorded
    from notification_logs
    where event_type = 'order.confirmation'
  `)) as unknown as Array<{ with_meta: string; total: string; first_recorded: string | null }>;
  const m = meta[0];
  console.log(`\nATTACHMENT RECORD (notification_logs.metadata, order.confirmation)`);
  console.log(`  ${m?.with_meta ?? 0} of ${m?.total ?? 0} rows carry a record`);
  console.log(`  first recorded: ${m?.first_recorded ?? 'none yet'}`);

  if (!APPLY) {
    console.log(`\nreport only — re-run with --apply to write ${supported ?? 25}\n`);
    return;
  }

  if (!supported) {
    console.log(`\nREFUSING: no ceiling under 60 minutes reaches 95%. Do not guess — re-read the distribution.\n`);
    process.exitCode = 1;
    return;
  }

  await updateSetting(KEY, String(supported));
  const readBack = await getSetting(KEY);
  console.log(`\nAPPLIED  ${KEY}: ${current} → ${readBack}`);
  if (readBack !== String(supported)) {
    console.log(`  READ-BACK MISMATCH — expected ${supported}, got ${readBack}`);
    process.exitCode = 1;
  }
  console.log();
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => scriptExit(Number(process.exitCode ?? 0)));
