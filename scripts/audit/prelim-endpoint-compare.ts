/**
 * Re-derive the prelim emptiness claim.
 *
 * Hub table (SQL, operational_status in open/in_process/completed):
 *   SELECT order_type,
 *     count(*) AS orders,
 *     count(*) FILTER (WHERE EXISTS (
 *       SELECT 1 FROM documents d
 *       WHERE d.order_id = o.id AND d.category = 'prelim' AND d.status = 'active'
 *     )) AS with_hub_prelim
 *   FROM orders o
 *   WHERE operational_status IN ('open','in_process','completed')
 *   GROUP BY order_type;
 *
 * SoftPro (this file): raw GET, no vendor_api_logs.
 *   GetAttachedDocuments?orderNumber=
 *   GetAttachedDocumentsPrelim?orderNumber=
 *
 * Sample buckets are newest files in each hub cell (T&E/Title-only ×
 * hub-has-prelim / hub-has-none). Re-pick by the same SQL, then re-run.
 *
 * 410/418 was T&E-with-no-prelim from GetAttachedDocuments on an older
 * snapshot. Re-run this file after re-picking SAMPLE the same way.
 *
 * Measured 2026-08-31: GetAttachedDocuments is empty on T&E files that
 * GetAttachedDocumentsPrelim returns as Preliminary Title Report_*.pdf.
 * The two endpoints are not supersets — Title-only files with a hub prelim
 * often hit on generic and 400 on Prelim. fetch-prelims still uses generic.
 */
import { SOFTPRO_ENDPOINTS } from '../../src/lib/integrations/softpro/types';

const SAMPLE: Array<{ bucket: string; file: string }> = [
  { bucket: 'te_no_prelim', file: '20021623-OCT' },
  { bucket: 'te_no_prelim', file: '20021575-OCT' },
  { bucket: 'te_no_prelim', file: '20021574-OCT' },
  { bucket: 'te_no_prelim', file: '20021553-OCT' },
  { bucket: 'te_has_prelim', file: '20021162-GLT' },
  { bucket: 'te_has_prelim', file: '20021137-GLT' },
  { bucket: 'te_has_prelim', file: '20020435-OCT' },
  { bucket: 'te_has_prelim', file: '20019167-GLT' },
  { bucket: 'to_has_prelim', file: '20021625-GLT' },
  { bucket: 'to_has_prelim', file: '20021622-OCT' },
  { bucket: 'to_has_prelim', file: '20021617-OCT' },
  { bucket: 'to_no_prelim', file: '20021643-GLT' },
  { bucket: 'to_no_prelim', file: '20021642-OCT' },
  { bucket: 'to_no_prelim', file: '20021641-OCT' },
];

async function softproGet(path: string, params: Record<string, string>) {
  const base = process.env.SOFTPRO_API_URL;
  const token = process.env.SOFTPRO_TOKEN;
  if (!base) throw new Error('SOFTPRO_API_URL not set');
  const url = `${base}${path}?${new URLSearchParams(params)}`;
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
  console.log('file\tbucket\tGetAttachedDocuments\tGetAttachedDocumentsPrelim');
  for (const row of SAMPLE) {
    const [generic, prelim] = await Promise.all([
      softproGet(SOFTPRO_ENDPOINTS.getAttachedDocuments, { orderNumber: row.file }),
      softproGet('ordercreation/GetAttachedDocumentsPrelim', { orderNumber: row.file }),
    ]);
    console.log(`${row.file}\t${row.bucket}\t${generic.n}\t${prelim.n}\tprelimStatus=${String(prelim.status)} ${prelim.message}`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
