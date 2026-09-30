/**
 * READ-ONLY. Dump one stored payload's key paths, optionally filtered.
 *
 * Faster than concierge-tax-fields-available.mts when the question is only
 * "does SiteX send this field at all" — reads ONE payload rather than all of
 * them. Use the full script when absence needs to be distinguished from
 * "absent on this parcel".
 *
 *   npx tsx --env-file=.env.local scripts/audit/concierge-payload-keys.mts [regex]
 */
import { eq } from 'drizzle-orm';
import { db } from '../../src/lib/db/client';
import { conciergeProfiles } from '../../src/lib/db/schema/concierge';
import { downloadFile } from '../../src/lib/integrations/s3/client';

const filter = process.argv[2] ? new RegExp(process.argv[2], 'i') : null;

function paths(node: unknown, prefix = '', out: [string, unknown][] = []): [string, unknown][] {
  if (node === null || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    if (node.length > 0) paths(node[0], `${prefix}[]`, out);
    return out;
  }
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object') paths(v, p, out);
    else out.push([p, v]);
  }
  return out;
}

const [p] = await db.select().from(conciergeProfiles)
  .where(eq(conciergeProfiles.id, Number(process.env.PROFILE_ID ?? '4')));
if (!p?.rawStorageKey) throw new Error('no stored payload');
const got = await downloadFile(p.rawStorageKey);
if (!got.success || !got.data) throw new Error('unreadable');

const all = paths(JSON.parse(got.data.toString('utf8')));
const rows = filter ? all.filter(([k]) => filter.test(k)) : all;
console.log(`profile ${p.id} · ${rows.length} of ${all.length} key paths\n`);
for (const [k, v] of rows.sort()) {
  console.log(`  ${k.replace('Feed.PropertyProfile.', 'PP.').padEnd(58)} ${v === null ? '(null)' : String(v).slice(0, 30)}`);
}
process.exit(0);
