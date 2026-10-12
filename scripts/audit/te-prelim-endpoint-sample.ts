/**
 * Re-derive T&E GetAttachedDocumentsPrelim hit/400 rate.
 *
 * Hub pick (same as fetch_prelims eligibility, T&E-only):
 *   SELECT file_number FROM orders o
 *   WHERE order_type = 'Title & Escrow'
 *     AND operational_status IN ('open','in_process','completed')
 *     AND NOT EXISTS (
 *       SELECT 1 FROM documents d
 *       WHERE d.order_id = o.id AND d.category = 'prelim' AND d.status = 'active'
 *     )
 *   ORDER BY coalesce(opened_at, created_at) DESC
 *
 * SoftPro: GET ordercreation/GetAttachedDocumentsPrelim?orderNumber=
 * Sample below was the 20 newest from that SQL on 2026-08-31.
 *
 * Does not ingest. Does not call TESSA.
 */
import { config } from 'dotenv';

config({ path: 'C:/Users/gerar/Desktop/TransactionDeskV2/td-hub/.env.local' });

const SAMPLE = [
  '20021623-OCT', '20021575-OCT', '20021574-OCT', '20021553-OCT',
  '20021546-OCT', '20021542-OCT', '20021533-OCT', '20021521-GLT',
  '20021518-OCT', '20021509-OCT', '20021493-OCT', '20021474-OCT',
  '20021466-OCT', '20021453-OCT', '20021428-PRV', '20021417-OCT',
  '20021389-OCT', '20021382-PRV', '20021382-OCT', '20021381-GLT',
];

async function prelimGet(file: string) {
  const base = process.env.SOFTPRO_API_URL;
  const token = process.env.SOFTPRO_TOKEN;
  if (!base) throw new Error('SOFTPRO_API_URL not set');
  const url = `${base}ordercreation/GetAttachedDocumentsPrelim?${new URLSearchParams({ orderNumber: file })}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'X-API-KEY': token } : {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  const body = await res.json() as Record<string, unknown>;
  const n = Array.isArray(body.data) ? body.data.length : -1;
  return { http: res.status, status: body.Status, n, message: String(body.Message ?? '') };
}

(async () => {
  let hit = 0;
  let empty = 0;
  let err400 = 0;
  let other = 0;
  for (const file of SAMPLE) {
    const r = await prelimGet(file);
    const kind = r.n > 0 ? 'HIT' : (r.http === 400 || r.status === 400 || /400/.test(String(r.status)) ? '400' : (r.n === 0 ? 'EMPTY' : 'OTHER'));
    if (kind === 'HIT') hit++;
    else if (kind === '400') err400++;
    else if (kind === 'EMPTY') empty++;
    else other++;
    console.log(`${file}\t${kind}\thttp=${r.http}\tstatus=${String(r.status)}\tn=${r.n}\t${r.message.slice(0, 80)}`);
  }
  console.log(`sample=${SAMPLE.length} hit=${hit} empty=${empty} http400=${err400} other=${other}`);
})().catch((e) => { console.error(e); process.exit(1); });
