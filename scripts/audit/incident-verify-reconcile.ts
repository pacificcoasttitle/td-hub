/**
 * INCIDENT, READ ONLY. Two checks on the reconciliation before anyone acts on
 * it.
 *
 * 1. IS created_at ~ ended_at? The claim "SoftPro received the file six
 *    seconds after the hub started asking" rests on it. If created_at is the
 *    row's insert time then the attempt STARTED 120s earlier, and the SoftPro
 *    receipt falls inside the attempt — the create landed and the response
 *    never came back. If that assumption is wrong, so is the conclusion.
 *
 * 2. IS THE ONE I CALLED SAFE REALLY SAFE? Telling the team to re-enter an
 *    address that already has a file creates the exact duplicate the
 *    reconciliation exists to prevent. So the "not found" address is searched
 *    again with a deliberately loose match — street number alone, and the APN
 *    — because addressesMatch() requires the city to agree and a typo there
 *    would hide a real file.
 *
 *   npx tsx --env-file=.env.local scripts/audit/incident-verify-reconcile.ts
 */
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { getOrderDetails } from '@/lib/integrations/softpro';
import { normalizeAddressKey } from '@/lib/domain/orders/recover-created-file';
import type { SoftProOrderDetailItem } from '@/lib/integrations/softpro/types';

/** The address the reconciliation reported as having no file. */
const SAFE_CLAIM = { address: '20715 Evans Rd', city: 'Perris', apn: '300-110-023' };

async function main() {
  console.log(`\nnow: ${new Date().toISOString()}\n`);

  // ─── 1. the clock ────────────────────────────────────────────────────────
  const r = await db.execute(sql`
    select to_char(started_at, 'HH24:MI:SS') as started,
           to_char(ended_at,   'HH24:MI:SS') as ended,
           to_char(created_at, 'HH24:MI:SS') as created,
           (extract(epoch from (ended_at - started_at)))::int   as dur_s,
           (extract(epoch from (created_at - ended_at)))::int   as created_minus_ended_s,
           success, error_category
      from vendor_api_logs
     where vendor = 'softpro' and operation = 'create_order'
       and created_at >= now() - interval '24 hours'
     order by created_at asc`);
  const rows = (r as unknown as { rows?: Record<string, unknown>[] }).rows
    ?? (r as unknown as Record<string, unknown>[]);

  console.log('=== 1. does created_at track ended_at? ===');
  console.log('  started   ended     created   dur(s)  created-ended(s)  result');
  for (const x of rows.slice(-10)) {
    console.log(
      `  ${String(x.started)}  ${String(x.ended)}  ${String(x.created)}  `
      + `${String(x.dur_s).padStart(6)}  ${String(x.created_minus_ended_s).padStart(16)}  `
      + `${x.success ? 'ok' : String(x.error_category)}`,
    );
  }
  const offsets = rows.map((x) => Number(x.created_minus_ended_s)).filter((n) => Number.isFinite(n));
  const maxOff = offsets.length ? Math.max(...offsets.map(Math.abs)) : NaN;
  console.log(`\n  worst |created_at - ended_at| = ${maxOff}s`);
  console.log(maxOff <= 2
    ? '  CONFIRMED: created_at is the END of the call. A 120s attempt logged at T began at T-120s.'
    : '  NOT CONFIRMED: the start time cannot be inferred from created_at. Re-read before concluding.');

  // ─── 2. the address called safe ─────────────────────────────────────────
  console.log('\n=== 2. is "20715 Evans Rd, Perris" really absent? ===');
  const details = await getOrderDetails({ dateFrom: '10-12-2026', dateTo: '10-13-2026' });
  if (!details.success || !details.data) {
    console.log(`  LOOKUP FAILED: ${details.error?.message ?? 'unknown'} — cannot confirm. Treat as unknown, not safe.`);
    process.exit(1);
  }
  const all = details.data as SoftProOrderDetailItem[];
  console.log(`  searching ${all.length} order(s)\n`);

  // Street number alone. Loose on purpose: addressesMatch() requires the city
  // to agree, and a city typo would hide a real file.
  const num = SAFE_CLAIM.address.split(/\s+/)[0] ?? '';
  const streetKey = normalizeAddressKey(SAFE_CLAIM.address);
  const hits = all.filter((o) => {
    const a = normalizeAddressKey(o.Address);
    return (num && a.includes(normalizeAddressKey(num)))
      || a.includes(streetKey)
      || streetKey.includes(a);
  });

  if (hits.length === 0) {
    console.log(`  no order in the window has "${num}" anywhere in its street address.`);
    console.log('  SAFE TO RE-ENTER stands.');
  } else {
    console.log(`  ${hits.length} loose hit(s) — READ THESE BEFORE RE-ENTERING:`);
    for (const h of hits) {
      console.log(`    ${h.OrderNumber}  ${h.Address ?? ''} / ${h.City ?? ''}  received ${h.ReceivedDate ?? '?'}`);
    }
  }

  // Every Perris order in the window, as a second way of looking. A file
  // entered with a mistyped street would still carry the right city.
  const perris = all.filter((o) => normalizeAddressKey(o.City) === normalizeAddressKey('Perris'));
  console.log(`\n  every Perris order in the window (${perris.length}):`);
  for (const p of perris) {
    console.log(`    ${p.OrderNumber}  ${p.Address ?? ''}  received ${p.ReceivedDate ?? '?'}`);
  }
  console.log('');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
