/**
 * Read-only. Prints the raw name strings SoftPro returns for the four orders
 * the latched re-enrichment would write party rows to.
 *
 * The question this answers is narrow and worth stating exactly: the 21 planned
 * `external_name` values are either (a) copied verbatim out of this response by
 * `mapOrderContacts` + `nullableString`, or (b) transformed somewhere. Reading
 * the code says (a) — nothing on the path imports
 * `src/lib/domain/orders/names/`, and `nullableString` only trims. This prints
 * the vendor's own bytes so the claim rests on the response and not only on the
 * read.
 *
 * GET GetOrderContacts only. No writes to SoftPro, no vendor_api_logs row
 * (raw fetch, not the instrumented client).
 *
 *   npx tsx --env-file=.env.local scripts/audit/reenrich-raw-vendor-names.ts
 */
import { SOFTPRO_ENDPOINTS } from '@/lib/integrations/softpro/types';

const FILE_NUMBERS = ['20019920-GLT', '20020478-ONT', '20020599-ONT', '20021133-ONT'];

/** Every key in the response whose value is a human or company name. */
const NAME_KEY = /name|borrower|seller|owner/i;

/** Collect `path -> value` for every string field that looks like a name. */
function collectNames(node: unknown, path: string, out: Array<{ path: string; value: string }>) {
  if (node === null || node === undefined) return;
  if (typeof node === 'string') {
    if (node.trim() && NAME_KEY.test(path)) out.push({ path, value: node });
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item, i) => collectNames(item, `${path}[${i}]`, out));
    return;
  }
  if (typeof node === 'object') {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      collectNames(value, path ? `${path}.${key}` : key, out);
    }
  }
}

async function main() {
  const base = process.env.SOFTPRO_API_URL;
  if (!base) throw new Error('SOFTPRO_API_URL not set');
  console.log(`base url: ${base}`);

  for (const fileNumber of FILE_NUMBERS) {
    const url = `${base}${SOFTPRO_ENDPOINTS.getOrderContacts}`
      + `?${new URLSearchParams({ orderNumber: fileNumber }).toString()}`;

    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.SOFTPRO_TOKEN ? { 'X-API-KEY': process.env.SOFTPRO_TOKEN } : {}),
      },
      signal: AbortSignal.timeout(120_000),
    });

    console.log(`\n=== ${fileNumber} (HTTP ${res.status}) ===`);
    if (!res.ok) continue;

    const body = JSON.parse(await res.text()) as { data?: unknown };
    const found: Array<{ path: string; value: string }> = [];
    collectNames(body.data ?? null, '', found);
    console.log(JSON.stringify(found, null, 2));
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
