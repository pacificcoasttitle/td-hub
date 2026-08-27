/**
 * READ-ONLY. Exercises the new ingest gap detector against live data.
 *
 * Two things are being checked at once: that the detector works, and that the
 * recovery actually closed the hole. A clean run means SoftPro's list for the
 * trailing window and ours agree exactly.
 *
 * One GetOrders call plus one indexed lookup. Writes nothing.
 */
import { detectIngestGap } from '../../src/lib/jobs/handlers/verify-order-sync';

async function main() {
  const gap = await detectIngestGap();

  console.log('window       :', gap.dateFrom, '->', gap.dateTo, `(${gap.windowDays}d)`);
  console.log('vendor count :', gap.vendorCount);
  console.log('held count   :', gap.heldCount);
  console.log('missing      :', gap.missingCount === null ? 'UNKNOWN (vendor unusable)' : gap.missingCount);
  console.log('unavailable  :', gap.vendorUnavailable);
  console.log('error        :', gap.error ?? 'none');

  if (gap.missingSample.length > 0) {
    console.log('missing sample:');
    for (const n of gap.missingSample) console.log('  -', n);
  }

  if (gap.missingCount === null) {
    console.log('\nRESULT: inconclusive - the vendor list was unusable, which is reported as');
    console.log('        unknown rather than zero. This is the intended behaviour.');
  } else if (gap.missingCount === 0) {
    console.log('\nRESULT: clean - every order SoftPro lists for the window is present.');
  } else {
    console.log(`\nRESULT: ${gap.missingCount} order(s) SoftPro has that we do not.`);
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('FAILED:', err);
    process.exit(1);
  },
);
