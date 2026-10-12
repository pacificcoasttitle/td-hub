/**
 * Read-only GetOrderDetails probe for the three named orders in the
 * APN/county/address measurement. Raw fetch — does not go through client.ts,
 * so it does not write vendor_api_logs. GET only; never createOrder.
 *
 *   npx tsx --env-file=.env.local scripts/audit/measure-apn-county-address-vendor.ts
 */
import { SOFTPRO_ENDPOINTS } from '@/lib/integrations/softpro/types';

const FILE_NUMBERS = ['20021529-OCT', '20021535-OCT', '20018884-OCT'];

const PROPERTY_KEYS = /apn|parcel|county|country|address|city|state|zip|legal/i;

function collect(
  node: unknown,
  path: string,
  out: Array<{ path: string; value: unknown }>,
) {
  if (node === null || node === undefined) return;
  if (typeof node !== 'object') {
    if (PROPERTY_KEYS.test(path)) out.push({ path, value: node });
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item, i) => collect(item, `${path}[${i}]`, out));
    return;
  }
  const rec = node as Record<string, unknown>;
  for (const [key, value] of Object.entries(rec)) {
    const next = path ? `${path}.${key}` : key;
    if (PROPERTY_KEYS.test(key) || typeof value !== 'object' || value === null) {
      if (PROPERTY_KEYS.test(key) || PROPERTY_KEYS.test(next)) {
        out.push({
          path: next,
          value: typeof value === 'object' ? `[${value === null ? 'null' : Array.isArray(value) ? 'array' : 'object'}]` : value,
        });
      }
    }
    if (value !== null && typeof value === 'object') collect(value, next, out);
  }
}

async function readDetails(fileNumber: string): Promise<Record<string, unknown>> {
  const base = process.env.SOFTPRO_API_URL;
  if (!base) throw new Error('SOFTPRO_API_URL not set');
  const root = base.endsWith('/') ? base : `${base}/`;
  const url = `${root}${SOFTPRO_ENDPOINTS.getOrderDetails}?${new URLSearchParams({
    DateFrom: '',
    DateTo: '',
    OrderNumber: fileNumber,
  }).toString()}`;
  const token = process.env.SOFTPRO_TOKEN;

  const res = await fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { 'X-API-KEY': token } : {}) },
    signal: AbortSignal.timeout(120_000),
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    return { fileNumber, httpStatus: res.status, error: 'non-JSON', snippet: text.slice(0, 300) };
  }

  const envelope = body as { Status?: number; Message?: string; data?: unknown };
  const rows = Array.isArray(envelope.data) ? envelope.data : [];
  const first = (rows[0] ?? null) as Record<string, unknown> | null;
  const keys = first ? Object.keys(first).sort() : [];
  const apnLike = keys.filter((k) => /apn|parcel/i.test(k));
  const fields = first
    ? {
        OrderNumber: first.OrderNumber ?? null,
        Address: first.Address ?? null,
        City: first.City ?? null,
        State: first.State ?? null,
        Zip: first.Zip ?? null,
        Country: first.Country ?? null,
        ReceivedDate: first.ReceivedDate ?? null,
        OrderStatus: first.OrderStatus ?? null,
        TransactionType: first.TransactionType ?? null,
      }
    : null;
  const propertyHits: Array<{ path: string; value: unknown }> = [];
  collect(body, '', propertyHits);

  return {
    fileNumber,
    httpStatus: res.status,
    envelopeStatus: envelope.Status ?? null,
    envelopeMessage: envelope.Message ?? null,
    resultCount: rows.length,
    topLevelKeys: keys,
    apnLikeKeys: apnLike,
    fields,
    propertyHits,
    fetchedAtUtc: new Date().toISOString(),
  };
}

async function main() {
  const measuredAt = new Date().toISOString();
  console.log(JSON.stringify({ measuredAt, source: 'GetOrderDetails raw fetch, no vendor_api_logs' }));
  for (const fileNumber of FILE_NUMBERS) {
    const row = await readDetails(fileNumber);
    console.log(JSON.stringify(row, null, 2));
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
