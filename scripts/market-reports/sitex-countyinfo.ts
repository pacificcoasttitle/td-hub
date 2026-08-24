/**
 * GET /search/farm/countyinfo — "retrieve cities, zip codes and subdivisions
 * for a county". Metadata sibling of /search/countyinfo, which the phase-0
 * spike measured as free.
 *
 * NOT called here: POST /search/farm and POST /search/farm/count. Those are the
 * product; their cost is unmeasured and this ticket authorises no spend.
 *
 * Credits are read before and after so the run can prove what it cost.
 */
import { getConfig, getAccessToken } from '../../src/lib/integrations/sitex/auth';
import fs from 'node:fs';

const cfg = getConfig()!;
const FEED = '100003';

const COUNTIES: Array<[string, string]> = [
  ['06037', 'Los Angeles'],
  ['06059', 'Orange'],
  ['06065', 'Riverside'],
  ['06071', 'San Bernardino'],
  ['06073', 'San Diego'],
  ['06111', 'Ventura'],
];

(async () => {
  const token = await getAccessToken(cfg.baseUrl, cfg.clientId, cfg.clientSecret);
  const get = async (path: string) => {
    const r = await fetch(`${cfg.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(60_000),
    });
    const t = await r.text();
    try { return { status: r.status, body: JSON.parse(t) as unknown }; }
    catch { return { status: r.status, body: t as unknown }; }
  };

  const before = await get('/realestatedata/search/credits');
  console.log(`credits before: ${JSON.stringify(before.body)}`);

  const out: Record<string, unknown> = {};
  for (const [fips, name] of COUNTIES) {
    const r = await get(`/realestatedata/search/farm/countyinfo?fips=${fips}&feedId=${FEED}`);
    const b = r.body as { Cities?: string[]; Zipcodes?: string[]; Subdivisions?: string[]; StatusCode?: string; ErrorMessage?: string };
    console.log(
      `${name.padEnd(15)} fips ${fips}  HTTP ${r.status}  ` +
      `cities ${String(b?.Cities?.length ?? '-').padStart(4)}  ` +
      `zips ${String(b?.Zipcodes?.length ?? '-').padStart(4)}  ` +
      `subdivisions ${String(b?.Subdivisions?.length ?? '-').padStart(6)}` +
      (b?.ErrorMessage ? `  ERR ${b.ErrorMessage}` : ''),
    );
    if (b?.Cities?.length) console.log(`                 sample cities: ${b.Cities.slice(0, 6).join(', ')}`);
    out[fips] = r.body;
  }

  const after = await get('/realestatedata/search/credits');
  console.log(`\ncredits after:  ${JSON.stringify(after.body)}`);

  fs.writeFileSync('sitex-countyinfo.json', JSON.stringify(out, null, 2));
  console.log('raw -> sitex-countyinfo.json');
  process.exit(0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
