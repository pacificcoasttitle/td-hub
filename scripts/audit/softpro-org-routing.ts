/**
 * READ-ONLY. No SiteX, no credits. GetOrderContacts only.
 *
 * THE ROUTING QUESTION: when SoftPro itself holds an organization as a buyer or
 * seller, which field carries the name, and is any entity flag set?
 *
 * This replaces a guess. Which SoftPro field takes an org name is undocumented
 * in this repo, and writing to the wrong one produces another
 * accepted-and-discarded write — the failure mode this whole investigation
 * exists to stop repeating.
 *
 * Candidates are orders SoftPro synced TO us whose buyer or seller name looks
 * like an entity, so SoftPro is the source of truth for how it stores them.
 */
import postgres from 'postgres';
import { getOrderContacts } from '../../src/lib/integrations/softpro/client';

const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });

/** Every leaf under a role, so nothing is missed by looking only where I expect. */
function leaves(o: unknown, path = '', out: Array<[string, string]> = []): Array<[string, string]> {
  if (o === null || o === undefined) { out.push([path, String(o)]); return out; }
  if (typeof o !== 'object') { out.push([path, JSON.stringify(o)]); return out; }
  if (Array.isArray(o)) { o.forEach((v, i) => leaves(v, `${path}[${i}]`, out)); return out; }
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    leaves(v, path ? `${path}.${k}` : k, out);
  }
  return out;
}

const ORG_RE = /\b(LLC|L\.L\.C|INC|CORP|TRUST|COMPANY|HOLDINGS|VENTURES|ESTATES|PARTNERS|ORGANIZATION|GROUP)\b/i;

(async () => {
  const rows = await sql.unsafe(`
    select distinct o.file_number, o.opened_at::date::text as opened, o.opened_at, pt.role, pt.external_name
    from order_parties pt join orders o on o.id = pt.order_id
    where o.source='softpro_sync'
      and pt.role in ('buyer','seller')
      and (pt.external_name ilike '%LLC%' or pt.external_name ilike '%TRUST%'
           or pt.external_name ilike '% INC%' or pt.external_name ilike '%CORP%')
    order by o.opened_at desc limit 12`);

  console.log(`reading back ${rows.length} SoftPro-synced orders with an org buyer/seller\n`);

  // Which populated leaves ever hold an org-looking value, and under what path?
  const orgPaths = new Map<string, { hits: number; samples: string[] }>();
  const personPaths = new Map<string, number>();
  const allPathsSeen = new Set<string>();

  for (const r of rows) {
    const fn = String(r.file_number);
    const res = await getOrderContacts(fn);
    if (!res.success) { console.log(`${fn.padEnd(15)} GetOrderContacts FAILED: ${res.error?.message}`); continue; }

    const con = res.data as unknown as Record<string, unknown>;
    const scoped = { buyer: con.buyer, Sellers: con.Sellers };
    const ls = leaves(scoped).filter(([, v]) => v !== 'null' && v !== 'undefined' && v !== '""');

    console.log('─'.repeat(92));
    console.log(`${fn}  ${r.opened}  our ${r.role}: "${String(r.external_name).slice(0, 46)}"`);
    if (ls.length === 0) console.log('   (buyer and Sellers are both empty in SoftPro)');
    for (const [p, v] of ls) {
      allPathsSeen.add(p);
      const looksOrg = ORG_RE.test(v);
      console.log(`   ${p.padEnd(44)} = ${v.slice(0, 46)}${looksOrg ? '   <-- ORG-LOOKING' : ''}`);
      if (looksOrg) {
        const e = orgPaths.get(p) ?? { hits: 0, samples: [] };
        e.hits++; if (e.samples.length < 3) e.samples.push(v.slice(0, 40));
        orgPaths.set(p, e);
      } else {
        personPaths.set(p, (personPaths.get(p) ?? 0) + 1);
      }
    }
  }

  console.log('\n' + '═'.repeat(92));
  console.log('WHICH FIELD CARRIES AN ORGANIZATION NAME');
  console.log('═'.repeat(92));
  if (orgPaths.size === 0) console.log('  (no org-looking value appeared in any buyer/seller field)');
  for (const [p, e] of [...orgPaths.entries()].sort((a, b) => b[1].hits - a[1].hits)) {
    console.log(`  ${p.padEnd(46)} ${String(e.hits).padStart(3)} hits   e.g. ${e.samples.join(' | ')}`);
  }

  console.log('\nSAME FIELDS, HOLDING PERSON NAMES (is there a separate Company path at all?)');
  for (const [p, n] of [...personPaths.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${p.padEnd(46)} ${String(n).padStart(3)} hits`);
  }

  console.log('\nEVERY buyer/Sellers PATH OBSERVED POPULATED:');
  console.log('  ' + [...allPathsSeen].sort().join('\n  '));

  console.log('\nIS THERE A Company SUB-OBJECT AT ALL, EVEN NULL?');
  const one = await getOrderContacts(String(rows[0]!.file_number));
  if (one.success) {
    const c = one.data as unknown as Record<string, unknown>;
    console.log('  buyer   =', JSON.stringify(c.buyer));
    console.log('  Sellers =', JSON.stringify(c.Sellers));
  }

  await sql.end();
  process.exit(0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
