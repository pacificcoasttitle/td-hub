/**
 * READ-ONLY: GetAttachedDocuments for the seven orders that hold LV / grant
 * deed / tax rows. No AddDocuments. Raw fetch so this does not write
 * vendor_api_logs.
 *
 *   npx tsx --env-file=.env.local scripts/audit/title-docs-softpro-attached.ts
 */
import { SOFTPRO_ENDPOINTS } from '../../src/lib/integrations/softpro/types';

const FILES = [
  '20015761-GLT',
  '20018616-GLT',
  '20018618-GLT',
  '20020403-GLT',
  '20020404-GLT',
  '20021376-OCT',
  '20021378-GLT',
];

function summarizeItem(item: unknown): Record<string, unknown> {
  if (typeof item === 'string') {
    let last = item;
    try {
      last = decodeURIComponent(new URL(item).pathname.split('/').filter(Boolean).pop() ?? item);
    } catch { /* keep raw */ }
    return { shape: 'string', fileName: last, url: item.slice(0, 160) };
  }
  if (item && typeof item === 'object') {
    const row = item as Record<string, unknown>;
    return {
      shape: 'object',
      keys: Object.keys(row),
      FileName: row.FileName ?? row.fileName ?? null,
      DocumentName: row.DocumentName ?? row.documentName ?? null,
      FolderName: row.FolderName ?? row.folderName ?? null,
    };
  }
  return { shape: typeof item, raw: String(item).slice(0, 120) };
}

async function main() {
  const base = process.env.SOFTPRO_API_URL;
  const token = process.env.SOFTPRO_TOKEN;
  if (!base) throw new Error('SOFTPRO_API_URL not set');

  for (const fileNumber of FILES) {
    const url = `${base}${SOFTPRO_ENDPOINTS.getAttachedDocuments}?${new URLSearchParams({ orderNumber: fileNumber })}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'X-API-KEY': token } : {}),
      },
      signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      console.log(`\n=== ${fileNumber} HTTP ${res.status} unparseable ===`);
      console.log(text.slice(0, 400));
      continue;
    }
    const envelope = body as { Status?: unknown; Message?: unknown; data?: unknown };
    const data = Array.isArray(envelope.data) ? envelope.data : [];
    console.log(`\n=== ${fileNumber} HTTP ${res.status} Status=${String(envelope.Status)} items=${data.length} ===`);
    if (envelope.Message) console.log(`message: ${String(envelope.Message).slice(0, 240)}`);
    for (const item of data) {
      console.log(JSON.stringify(summarizeItem(item)));
    }
    if (data.length === 0) {
      console.log(JSON.stringify({ empty: true, dataType: envelope.data === null ? 'null' : typeof envelope.data }));
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
