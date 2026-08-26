import { getConfig, getAccessToken } from '../../src/lib/integrations/sitex/auth';
const cfg = getConfig()!;
(async () => {
  const token = await getAccessToken(cfg.baseUrl, cfg.clientId, cfg.clientSecret);
  const r = await fetch(`${cfg.baseUrl}/realestatedata/search/schema/${process.env.SITEX_FEED_ID}`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) });
  const schema = await r.json();
  const out: string[] = [];
  (function w(o: any, p: string) {
    if (!o || typeof o !== 'object') return;
    for (const [k, v] of Object.entries(o)) {
      if (/^(EntityCode|EntityCodeDesc|VestingCode|VestingCodeDesc)$/.test(k)) {
        out.push(`${p}.${k} => ${JSON.stringify(v)}`);
      }
      w(v, p ? `${p}.${k}` : k);
    }
  })(schema, '');
  console.log('SCHEMA DECLARATIONS (does it document an enum / value domain?)');
  for (const l of [...new Set(out)]) console.log('  ' + l.slice(0, 200));

  // Which parent objects own them, precisely.
  const parents: string[] = [];
  (function w(o: any, p: string) {
    if (!o || typeof o !== 'object') return;
    for (const [k, v] of Object.entries(o)) {
      if (k === 'properties' && v && typeof v === 'object') {
        const keys = Object.keys(v as object);
        if (keys.some((x) => /^(EntityCode|VestingCode)$/.test(x))) parents.push(`${p}  ->  ${keys.join(', ').slice(0, 150)}`);
      }
      w(v, p ? `${p}.${k}` : k);
    }
  })(schema, '');
  console.log('\nPARENT OBJECTS THAT DECLARE THEM');
  for (const l of [...new Set(parents)]) console.log('  ' + l);
  process.exit(0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
