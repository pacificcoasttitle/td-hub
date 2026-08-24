/**
 * SiteX capability probe for the Market Intelligence rebuild.
 *
 * FREE ENDPOINTS ONLY. The billable call is GET /realestatedata/search with an
 * address; nothing here touches it. The discovery endpoints below were measured
 * as free during the concierge phase-0 spike (UAT credits 292 -> 292 across a
 * full sweep), and a 4xx costs nothing either way.
 *
 * Question being answered:
 *   1. Is feed 100003 (Farms_194) entitled to these credentials?
 *   2. Does any feed's options/schema expose GEOGRAPHIC selection — circle,
 *      zip, carrier route — as opposed to one-address lookup?
 *   3. Can anything here return city-level closed sales for a county, or
 *      countywide aggregates?
 */
import { getConfig, getAccessToken } from '../../src/lib/integrations/sitex/auth';

const cfg = getConfig();
if (!cfg) { console.error('SITEX_BASE_URL not set'); process.exit(1); }

const OUT: Record<string, unknown> = {};
let calls = 0;

async function free(path: string, token: string): Promise<{ status: number; body: unknown }> {
  calls++;
  const url = `${cfg!.baseUrl}${path}`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await r.text();
  let body: unknown = text;
  try { body = JSON.parse(text); } catch { /* leave as text */ }
  return { status: r.status, body };
}

function brief(v: unknown, max = 900): string {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > max ? `${s.slice(0, max)}…[${s.length} chars]` : s;
}

(async () => {
  console.log(`BASE ${cfg.baseUrl}`);
  const token = await getAccessToken(cfg.baseUrl, cfg.clientId, cfg.clientSecret);
  console.log('token acquired (not printed)\n');

  // ── 1. What are we entitled to? ────────────────────────────────────────────
  const feeds = await free('/realestatedata/search/feeds', token);
  console.log(`FEEDS  HTTP ${feeds.status}`);
  const list = Array.isArray(feeds.body) ? feeds.body : (feeds.body as { Feeds?: unknown[] })?.Feeds;
  if (Array.isArray(list)) {
    for (const f of list) {
      const o = f as Record<string, unknown>;
      console.log(`   ${String(o.FeedId ?? o.feedId ?? '?').padEnd(8)} ${String(o.FeedName ?? o.Name ?? o.feedName ?? '?')}`);
    }
    OUT.feeds = list;
  } else {
    console.log(`   ${brief(feeds.body)}`);
  }

  // ── 2. Per-feed knobs and shape ────────────────────────────────────────────
  const ids = ['100001', '100002', '100003'];
  for (const id of ids) {
    console.log(`\n── FEED ${id} ─────────────────────────────`);
    for (const kind of ['options', 'schema'] as const) {
      const r = await free(`/realestatedata/search/${kind}/${id}`, token);
      console.log(`  ${kind.padEnd(8)} HTTP ${r.status}  ${brief(r.body, kind === 'options' ? 1400 : 700)}`);
      OUT[`${id}.${kind}`] = r.body;
    }
  }

  // ── 3. County-level data ───────────────────────────────────────────────────
  console.log('\n── COUNTYINFO ─────────────────────────────');
  const county = await free('/realestatedata/search/countyinfo', token);
  console.log(`  HTTP ${county.status}  ${brief(county.body, 1200)}`);
  OUT.countyinfo = county.body;

  console.log(`\nfree calls made: ${calls}   billable /search calls: 0`);
  const fs = await import('node:fs');
  fs.writeFileSync('sitex-probe.json', JSON.stringify(OUT, null, 2));
  console.log('raw responses -> sitex-probe.json (gitignored; ~1.2MB)');
  process.exit(0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
