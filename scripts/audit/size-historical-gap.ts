/**
 * READ-ONLY. Sizes total ingest loss by walking SoftPro's order list backwards
 * in windows and diffing it against ours.
 *
 * The today-only sync window was in place for the whole life of the integration,
 * so the 221 orders recovered for 2026-07-16..2026-08-27 are only the part a
 * file-number sequence scan could see. This measures the rest the sound way:
 * ask the vendor what exists for a range, compare directly, count what we lack.
 *
 * Writes NOTHING. One GetOrders call plus one indexed lookup per window.
 */
import { detectIngestGap } from '../../src/lib/jobs/handlers/verify-order-sync';

/** Our earliest order is 2025-03-05; start a little before it. */
const START = Date.UTC(2025, 2, 1);
/** The recovery already covered everything from here forward. */
const END = Date.UTC(2026, 6, 15);

const WINDOW_DAYS = 7;
const DAY_MS = 86_400_000;

function fmt(ms: number): string {
  const d = new Date(ms);
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${month}-${day}-${d.getUTCFullYear()}`;
}

async function main() {
  const windows: Array<{ from: number; to: number }> = [];
  for (let to = END; to >= START; to -= WINDOW_DAYS * DAY_MS) {
    windows.push({ from: Math.max(START, to - (WINDOW_DAYS - 1) * DAY_MS), to });
  }

  console.log(`scanning ${windows.length} windows of ${WINDOW_DAYS}d, newest first\n`);
  console.log('window                    vendor   held  missing  note');

  let totalVendor = 0;
  let totalMissing = 0;
  let unusable = 0;
  const byMonth = new Map<string, { vendor: number; missing: number }>();
  const allMissing: string[] = [];

  for (const w of windows) {
    const dateFrom = fmt(w.from);
    const dateTo = fmt(w.to);
    const gap = await detectIngestGap({ dateFrom, dateTo });

    const monthKey = `${new Date(w.to).getUTCFullYear()}-${String(new Date(w.to).getUTCMonth() + 1).padStart(2, '0')}`;
    const bucket = byMonth.get(monthKey) ?? { vendor: 0, missing: 0 };

    let note = '';
    if (gap.missingCount === null) {
      unusable++;
      note = `UNUSABLE: ${gap.error ?? 'unknown'}`;
    } else {
      totalVendor += gap.vendorCount;
      totalMissing += gap.missingCount;
      bucket.vendor += gap.vendorCount;
      bucket.missing += gap.missingCount;
      byMonth.set(monthKey, bucket);
      allMissing.push(...gap.missingSample);
    }

    console.log(
      `${dateFrom} -> ${dateTo}  ${String(gap.vendorCount).padStart(6)} ${String(gap.heldCount).padStart(6)} ${String(gap.missingCount ?? -1).padStart(8)}  ${note}`,
    );
  }

  console.log('\n--- by month (vendor / missing) ---');
  for (const key of [...byMonth.keys()].sort()) {
    const b = byMonth.get(key)!;
    const pct = b.vendor > 0 ? ((100 * b.missing) / b.vendor).toFixed(1) : '0.0';
    console.log(`${key}   vendor=${String(b.vendor).padStart(5)}  missing=${String(b.missing).padStart(5)}  (${pct}%)`);
  }

  console.log('\n--- total ---');
  console.log('windows scanned  :', windows.length);
  console.log('windows unusable :', unusable);
  console.log('vendor orders    :', totalVendor);
  console.log('missing from ours:', totalMissing);
  if (totalVendor > 0) {
    console.log('loss rate        :', `${((100 * totalMissing) / totalVendor).toFixed(1)}%`);
  }
  if (allMissing.length > 0) {
    console.log('\nsample of missing order numbers:');
    for (const n of allMissing.slice(0, 30)) console.log('  -', n);
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('FAILED:', err);
    process.exit(1);
  },
);
