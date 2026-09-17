/**
 * Fetch prelims that exist in SoftPro but are not in our storage. NO DELIVERY.
 *
 * WHY
 *
 * A SoftPro-side automation that generates the prelim summary on upload failed,
 * and prelims stopped reaching the hub. Gerard's instruction (2026-09-17): the
 * prelims must be present and visible in the hub; no emails. Delivery for
 * anything older than three days is being switched off separately (Cursor).
 *
 * The scheduled softpro.fetch_prelims job cannot be used for this:
 *   - it asks the GENERAL attached-documents endpoint, which missed the prelim on
 *     7 of 12 orders compared; this uses GetAttachedDocumentsPrelim
 *   - it ingests with deliver: true
 *
 * WHAT IT DOES, per order, strictly one request at a time
 *
 *   1. GetAttachedDocumentsPrelim for the file number
 *   2. for each prelim URL: ingestPrelimFromSoftPro({ deliver: false }) — the
 *      same ingest the webhook and the cron use, so the row is identical to a
 *      normally ingested prelim (category 'prelim', status 'active', S3, audit
 *      row), and identity dedupe makes a re-run a no-op
 *
 * It does not deliver, does not queue outbox events, does not run TESSA, and
 * does not touch orders columns.
 *
 * PACING (AGENTS.md, "Bulk reads of a vendor")
 *
 *   - one request at a time, never concurrent
 *   - PAUSE_MS after every SoftPro request, list or download
 *   - a hard ceiling on total SoftPro requests (MAX_REQUESTS)
 *   - stops at the first sign of a block: a non-JSON response or HTTP 403
 *
 * POPULATION
 *
 *   Orders with no active prelim document, opened since --since, newest first;
 *   then orders opened since --active-from that are still open / in process /
 *   on hold, newest first.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/one-off/backfill-prelims-from-softpro.mts \
 *     --out=<progress.jsonl> [--commit] [--since=2026-08-28] [--active-from=2026-06-01] \
 *     [--pause-ms=2000] [--max-requests=1600] [--limit=N]
 *
 * Without --commit it only lists: it calls GetAttachedDocumentsPrelim and
 * records what SoftPro holds, and writes nothing.
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import postgres from 'postgres';
import { getAttachedDocumentsPrelim } from '@/lib/integrations/softpro/client';
import { ingestPrelimFromSoftPro } from '@/lib/domain/documents/ingest-prelim-from-softpro';

const arg = (name: string, fallback?: string) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const COMMIT = process.argv.includes('--commit');
const OUT = arg('out');
const SINCE = arg('since', '2026-08-28')!;
const ACTIVE_FROM = arg('active-from', '2026-06-01')!;
const PAUSE_MS = Number(arg('pause-ms', '2000'));
const MAX_REQUESTS = Number(arg('max-requests', '1600'));
const LIMIT = arg('limit') ? Number(arg('limit')) : null;

if (!OUT) { console.error('--out=<progress.jsonl> is required'); process.exit(1); }
if (!/^\d{4}-\d{2}-\d{2}$/.test(SINCE) || !/^\d{4}-\d{2}-\d{2}$/.test(ACTIVE_FROM)) { console.error('dates must be YYYY-MM-DD'); process.exit(1); }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let requests = 0;
const log = (row: Record<string, unknown>) => appendFileSync(OUT, `${JSON.stringify({ at: new Date().toISOString(), ...row })}\n`);

// Resume: orders already finished in this progress file are not asked again.
const done = new Set<string>();
if (existsSync(OUT)) {
  for (const line of readFileSync(OUT, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r.fileNumber && r.final) done.add(r.fileNumber);
    } catch { /* partial line */ }
  }
}

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require', max: 1, connect_timeout: 30 });
const population = await sql<{ id: number; file_number: string; order_type: string | null; opened: string | null; tier: number }[]>`
  SELECT o.id, o.file_number, o.order_type, o.opened_at::text AS opened,
    CASE WHEN o.opened_at >= ${SINCE} THEN 1 ELSE 2 END AS tier
  FROM orders o
  WHERE NOT EXISTS (SELECT 1 FROM documents d WHERE d.order_id = o.id AND d.category = 'prelim' AND d.status = 'active')
    AND (o.opened_at >= ${SINCE}
      OR (o.opened_at >= ${ACTIVE_FROM} AND o.operational_status IN ('open', 'in_process', 'hold')))
  ORDER BY tier, o.opened_at DESC NULLS LAST, o.id DESC`;
await sql.end();

const todo = population.filter((o) => !done.has(o.file_number)).slice(0, LIMIT ?? undefined);
console.log(`${COMMIT ? 'COMMIT' : 'LIST ONLY'} | population ${population.length}, finished in earlier runs ${done.size}, this run ${todo.length}`);
console.log(`pacing: one request at a time, ${PAUSE_MS} ms pause after each, ceiling ${MAX_REQUESTS} SoftPro requests`);

const counts = { noPrelimInSoftPro: 0, prelimInSoftPro: 0, ingested: 0, deduped: 0, stale: 0, ingestFailed: 0, unreachable: 0 };

function looksBlocked(message: string | undefined): boolean {
  return !!message && (/Non-JSON response/.test(message) || /HTTP 403/.test(message));
}

for (const order of todo) {
  if (requests >= MAX_REQUESTS) { console.log(`ceiling of ${MAX_REQUESTS} requests reached; stopping`); break; }

  requests++;
  const listed = await getAttachedDocumentsPrelim(order.file_number);
  await sleep(PAUSE_MS);

  // SoftPro's answer for an order with no prelim is Status 400 "No attached file
  // found" (checked 2026-09-17 on 20022339-GLT, 20022340-OCT, 20022341-OCT), not
  // an empty list. That is bucket 1, not a failure to reach SoftPro.
  if (!listed.success && /No attached file found/i.test(listed.error?.message ?? '')) {
    counts.noPrelimInSoftPro++;
    log({ fileNumber: order.file_number, orderId: order.id, tier: order.tier, orderType: order.order_type, bucket: 'no_prelim_in_softpro', final: true });
    continue;
  }

  if (!listed.success) {
    const message = listed.error?.message ?? 'unknown';
    counts.unreachable++;
    log({ fileNumber: order.file_number, orderId: order.id, tier: order.tier, bucket: 'unreachable', error: message, final: false });
    if (looksBlocked(message)) { console.log(`STOPPING: looks like a block — ${message.slice(0, 160)}`); break; }
    continue;
  }

  const data = listed.data as unknown;
  const urls = (Array.isArray(data) ? data : []).filter((u): u is string => typeof u === 'string' && u.startsWith('http'));
  if (urls.length === 0) {
    counts.noPrelimInSoftPro++;
    log({ fileNumber: order.file_number, orderId: order.id, tier: order.tier, orderType: order.order_type, bucket: 'no_prelim_in_softpro', final: true });
    continue;
  }

  counts.prelimInSoftPro++;
  if (!COMMIT) {
    log({ fileNumber: order.file_number, orderId: order.id, tier: order.tier, orderType: order.order_type, bucket: 'prelim_in_softpro_not_stored', urls, final: true });
    continue;
  }

  const outcomes: Array<Record<string, unknown>> = [];
  let blocked = false;
  for (const url of urls) {
    if (requests >= MAX_REQUESTS) break;
    requests++;
    try {
      const r = await ingestPrelimFromSoftPro({
        orderId: order.id,
        fileNumber: order.file_number,
        documentUrl: url,
        source: 'softpro_fetch',
        createdBy: 'script:backfill_prelims_2026_09_17',
        deliver: false,
        triggeredBy: 'fetch_prelims',
      });
      counts[r.outcome === 'ingested' ? 'ingested' : r.outcome === 'deduped' ? 'deduped' : 'stale']++;
      outcomes.push({ url, outcome: r.outcome, documentId: r.documentId });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      counts.ingestFailed++;
      outcomes.push({ url, outcome: 'failed', error: message });
      if (/HTTP 403/.test(message)) blocked = true;
    }
    await sleep(PAUSE_MS);
    if (blocked) break;
  }
  const allOk = outcomes.length === urls.length && outcomes.every((o) => o.outcome !== 'failed');
  log({ fileNumber: order.file_number, orderId: order.id, tier: order.tier, orderType: order.order_type, bucket: 'prelim_in_softpro_not_stored', outcomes, final: allOk });
  if (blocked) { console.log('STOPPING: a download returned HTTP 403'); break; }

  const n = counts.noPrelimInSoftPro + counts.prelimInSoftPro + counts.unreachable;
  if (n % 10 === 0) console.log(`${n} orders | ${JSON.stringify(counts)} | ${requests} requests`);
}

console.log('FINAL', JSON.stringify(counts), `requests ${requests}`);
process.exit(0);
