/**
 * READ-ONLY. Does SoftPro's address mangling depend on OUR casing?
 *
 * Answering this by writing two test orders to staging would work, but it is
 * not necessary: every create we have ever sent is already in vendor_api_logs
 * with its exact Address1, and every resulting order can be read back. That is
 * a larger sample than two writes, costs nothing, and pollutes nothing.
 *
 * The test only discriminates if we have historically sent BOTH all-caps and
 * mixed-case streets. If every send was all-caps, this cannot separate the
 * variables and the staging write-test is required. The script says which.
 */
import postgres from 'postgres';
import { getOrderDetails } from '../../src/lib/integrations/softpro/client';

const sql = postgres(process.env.DATABASE_URL!, { max: 2, prepare: false });
const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '');

const casing = (v: string): 'ALL CAPS' | 'mixed' | 'other' => {
  const letters = v.replace(/[^A-Za-z]/g, '');
  if (!letters) return 'other';
  if (letters === letters.toUpperCase()) return 'ALL CAPS';
  if (letters === letters.toLowerCase()) return 'other';
  return 'mixed';
};

/** Trailing street-type token, which is what a normalizer would rewrite. */
const suffix = (v: string): string => {
  const parts = v.trim().split(/\s+/);
  return parts.length ? parts[parts.length - 1]!.toUpperCase().replace(/[^A-Z]/g, '') : '';
};

(async () => {
  const rows = await sql.unsafe(`
    select v.id, v.created_at, v.success,
           v.response_meta->>'orderNumber' as order_number,
           v.request_meta->'payload'->'propertyDetails'->0->>'Address1' as sent_address
    from vendor_api_logs v
    where v.vendor='softpro' and v.operation='create_order'
      and v.request_meta->'payload'->'propertyDetails'->0->>'Address1' is not null
    order by v.created_at asc`);

  console.log(`create payloads with an Address1: ${rows.length}\n`);

  const results: Array<{ on: string; sent: string; stored: string; cas: string; sfx: string; same: boolean }> = [];

  for (const r of rows) {
    const sent = String(r.sent_address);
    const on = r.order_number ? String(r.order_number) : '';
    if (!on) {
      console.log(`  ${casing(sent).padEnd(9)} ${suffix(sent).padEnd(6)} sent="${sent}"  -> no order number (create failed), cannot read back`);
      continue;
    }
    const day = new Date(r.created_at as Date).toISOString().slice(0, 10);
    const det = await getOrderDetails({ dateFrom: day, dateTo: day, orderNumber: on });
    const rec = (det.success && Array.isArray(det.data) ? det.data[0] : null) as Record<string, unknown> | null;
    const stored = rec ? String(rec.Address ?? '') : '';
    if (!rec) {
      console.log(`  ${casing(sent).padEnd(9)} ${suffix(sent).padEnd(6)} sent="${sent}"  -> ${on} not returned by GetOrderDetails`);
      continue;
    }
    const same = norm(sent) === norm(stored);
    results.push({ on, sent, stored, cas: casing(sent), sfx: suffix(sent), same });
    console.log(
      `  ${casing(sent).padEnd(9)} ${suffix(sent).padEnd(6)} sent="${sent}"`.padEnd(64) +
      `stored="${stored}"  ${same ? 'preserved' : '*** REWRITTEN ***'}`,
    );
  }

  console.log('\n' + '─'.repeat(90));
  const caps = results.filter((r) => r.cas === 'ALL CAPS');
  const mixed = results.filter((r) => r.cas === 'mixed');
  console.log(`ALL-CAPS sends : ${caps.length}   rewritten: ${caps.filter((r) => !r.same).length}`);
  console.log(`mixed-case sends: ${mixed.length}   rewritten: ${mixed.filter((r) => !r.same).length}`);

  console.log('\nby trailing street-type token:');
  const bySfx = new Map<string, { n: number; rewritten: number; examples: string[] }>();
  for (const r of results) {
    const e = bySfx.get(r.sfx) ?? { n: 0, rewritten: 0, examples: [] };
    e.n++; if (!r.same) { e.rewritten++; e.examples.push(`"${r.sent}" -> "${r.stored}"`); }
    bySfx.set(r.sfx, e);
  }
  for (const [sfx, e] of [...bySfx.entries()].sort((a, b) => b[1].rewritten - a[1].rewritten)) {
    console.log(`  ${sfx.padEnd(8)} sent ${String(e.n).padStart(2)}  rewritten ${e.rewritten}` +
      (e.examples.length ? `   ${e.examples.join(' | ')}` : ''));
  }

  console.log('\nVERDICT INPUTS');
  if (mixed.length === 0) {
    console.log('  We have NEVER sent a mixed-case street. Casing and street-type cannot be');
    console.log('  separated from this data alone — the staging write-test is required.');
  } else {
    console.log(`  Both casings are represented (${caps.length} caps / ${mixed.length} mixed), so the`);
    console.log('  comparison above is decisive on its own.');
  }
  await sql.end();
  process.exit(0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
