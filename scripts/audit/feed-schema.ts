/**
 * FREE ENDPOINTS ONLY. /search/schema and /search/options were measured as
 * non-billable during the concierge phase-0 spike. No /search call with an
 * address is made here.
 *
 * Question: does feed 100001 — the feed the ORDER-CREATE path uses — declare
 * any owner-type / entity / vesting field that we request and discard, or that
 * we could request?
 */
import { getConfig, getAccessToken } from '../../src/lib/integrations/sitex/auth';
const cfg = getConfig()!;
const FEED = process.env.SITEX_FEED_ID!;
(async () => {
  const token = await getAccessToken(cfg.baseUrl, cfg.clientId, cfg.clientSecret);
  const get = async (p: string) => {
    const r = await fetch(`${cfg.baseUrl}${p}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) });
    const t = await r.text();
    try { return JSON.parse(t); } catch { return t; }
  };

  const opts = await get(`/realestatedata/search/options/${FEED}`);
  console.log(`OPTIONS for feed ${FEED}: ${Array.isArray(opts) ? opts.length : '?'}`);
  if (Array.isArray(opts)) {
    const rel = opts.filter((o: Record<string, string>) =>
      /owner|vest|entity|corp|trust|party|name/i.test(`${o.Name} ${o.FieldGroupElementName} ${o.Description}`));
    console.log(`  owner/entity/vesting-related options: ${rel.length}`);
    for (const o of rel) console.log(`    ${String(o.Name).padEnd(26)} ${String(o.DataType).padEnd(7)} range=${String(o.Range).slice(0,30).padEnd(32)} ${String(o.Description).slice(0,90)}`);
    console.log('  all option names:');
    console.log('    ' + opts.map((o: Record<string,string>) => o.Name).join(', '));
  }

  const schema = await get(`/realestatedata/search/schema/${FEED}`);
  const text = JSON.stringify(schema);
  console.log(`\nSCHEMA bytes: ${text.length}`);
  const names = [...new Set(text.match(/"[A-Za-z0-9_]*(?:Owner|Vest|Entity|Corporate|Trust|PartyType)[A-Za-z0-9_]*"/g) ?? [])];
  console.log(`  field names in the schema matching owner/vest/entity/corporate/trust: ${names.length}`);
  for (const n of names.sort()) console.log(`    ${n}`);
  process.exit(0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
