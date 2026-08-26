import { getConfig, getAccessToken } from '../../src/lib/integrations/sitex/auth';
import fs from 'node:fs';
const cfg = getConfig()!;
const FEED = process.env.SITEX_FEED_ID!;
const LIVE = 'C:/Users/gerar/AppData/Local/Temp/claude/C--Users-gerar-Desktop-TransactionDeskV2/88e8e30d-907c-43cb-8a60-b81b7c45c128/scratchpad/sitex-live-100001.json';

(async () => {
  const token = await getAccessToken(cfg.baseUrl, cfg.clientId, cfg.clientSecret);
  const r = await fetch(`${cfg.baseUrl}/realestatedata/search/schema/${FEED}`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000),
  });
  const schema = await r.json() as { components?: { schemas?: Record<string, unknown> } };

  // Which schema object declares each field of interest?
  const TARGETS = ['VestingCode', 'VestingCodeDesc', 'EntityCode', 'EntityCodeDesc', 'PrimaryOwnerName', 'OwnerName', 'PartialOwnershipInterestTransfer'];
  const found: Record<string, string[]> = {};
  const walk = (o: unknown, path: string) => {
    if (!o || typeof o !== 'object') return;
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (TARGETS.includes(k) && path.includes('.properties')) {
        const owner = path.replace(/^components\.schemas\./, '').split('.properties')[0]!;
        (found[k] ??= []).push(owner || path);
      }
      walk(v, path ? `${path}.${k}` : k);
    }
  };
  walk(schema.components?.schemas ?? {}, 'components.schemas');

  console.log('WHICH SCHEMA OBJECT DECLARES EACH FIELD');
  for (const t of TARGETS) {
    console.log(`  ${t.padEnd(34)} ${(found[t] ?? ['(not found)']).join(' | ')}`);
  }

  console.log('\nDOES THE LIVE PRODUCTION PAYLOAD CARRY THEM?');
  const live = fs.readFileSync(LIVE, 'utf8');
  for (const t of TARGETS) {
    const n = (live.match(new RegExp(`"${t}"`, 'g')) ?? []).length;
    console.log(`  ${t.padEnd(34)} occurrences: ${n}`);
  }

  const j = JSON.parse(live) as Record<string, any>;
  console.log('\nEVERY VestingCode / EntityCode VALUE IN THE LIVE PAYLOAD');
  const vals: string[] = [];
  (function w(o: any, p: string) {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) return o.forEach((v, i) => w(v, `${p}[${i}]`));
    for (const [k, v] of Object.entries(o)) {
      if (/^(Vesting|Entity)Code(Desc)?$/.test(k)) vals.push(`  ${p}.${k} = ${JSON.stringify(v)}`);
      w(v, p ? `${p}.${k}` : k);
    }
  })(j, '');
  console.log(vals.length ? vals.join('\n') : '  (none present in this response)');
  process.exit(0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
