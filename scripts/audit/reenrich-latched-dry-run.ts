/**
 * Dry run of the latched-order re-enrichment, executed locally.
 *
 * Calls the real handler with `dryRun: true`, so the preview comes from the
 * same population query, the same mapper and the same identity resolution the
 * live run uses. Nothing is written: the handler's dry-run branch issues only
 * SELECTs, and the vendor read is injected here as a raw `fetch` so the probe
 * does not append the `vendor_api_logs` row that every call through
 * `client.ts` produces. GET GetOrderContacts only — no writes to SoftPro.
 *
 * The admin route (POST /api/admin/backfill/reenrich-latched-orders) is the
 * same handler and defaults to the same dry run; this script exists so the
 * preview can be captured and reviewed without an authenticated browser
 * session and without 96 vendor-log rows landing in production first.
 *
 *   npx tsx --env-file=.env.local scripts/audit/reenrich-latched-dry-run.ts
 */
import { handleReenrichLatchedOrders } from '@/lib/jobs/handlers/enrich-orders';
import { SOFTPRO_ENDPOINTS } from '@/lib/integrations/softpro/types';
import type { SoftProOrderContactsData } from '@/lib/integrations/softpro/types';

/** No Vercel function ceiling applies locally, so the whole set fits in one pass. */
const LOCAL_TIME_BUDGET_MS = 30 * 60 * 1000;

async function readContactsRaw(fileNumber: string): Promise<{
  success: boolean;
  data?: SoftProOrderContactsData | null;
  error?: { message: string } | null;
}> {
  const base = process.env.SOFTPRO_API_URL;
  if (!base) return { success: false, error: { message: 'SOFTPRO_API_URL not set' } };

  const url = `${base}${SOFTPRO_ENDPOINTS.getOrderContacts}`
    + `?${new URLSearchParams({ orderNumber: fileNumber }).toString()}`;
  const token = process.env.SOFTPRO_TOKEN;

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', ...(token ? { 'X-API-KEY': token } : {}) },
      signal: AbortSignal.timeout(120_000),
    });
    const text = await res.text();
    if (!res.ok) return { success: false, error: { message: `HTTP ${res.status}` } };

    const body = JSON.parse(text) as { data?: unknown };
    // client.ts unwraps `data`; a bare envelope carries no contacts at all.
    const data = (body.data ?? null) as SoftProOrderContactsData | null;
    if (!data) return { success: false, error: { message: 'response carried no data' } };
    return { success: true, data };
  } catch (err) {
    return { success: false, error: { message: err instanceof Error ? err.message : String(err) } };
  }
}

async function main() {
  const result = await handleReenrichLatchedOrders(
    { dryRun: true, timeBudgetMs: LOCAL_TIME_BUDGET_MS },
    { readContacts: readContactsRaw },
  );

  const { report, ...summary } = result;
  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));

  console.log('\n=== ORDERS THAT WOULD GAIN PARTY ROWS ===');
  const gaining = (report ?? []).filter((r) => r.wouldWrite.length > 0);
  console.log(JSON.stringify(gaining, null, 2));

  console.log('\n=== PARTY ROWS CARRYING AN EMAIL (recipient-changing subset) ===');
  const withEmail = gaining.flatMap((r) => r.wouldWrite
    .filter((p) => p.externalEmail)
    .map((p) => ({ fileNumber: r.fileNumber, ...p })));
  console.log(JSON.stringify(withEmail, null, 2));

  console.log('\n=== ROLE HISTOGRAM ACROSS THE PLAN ===');
  const byRole: Record<string, number> = {};
  for (const row of gaining) {
    for (const p of row.wouldWrite) {
      byRole[`${p.role}${p.isPrimary ? '' : ' (secondary)'}`]
        = (byRole[`${p.role}${p.isPrimary ? '' : ' (secondary)'}`] ?? 0) + 1;
    }
  }
  console.log(JSON.stringify(byRole, null, 2));

  console.log('\n=== VENDOR READ FAILURES ===');
  console.log(JSON.stringify((report ?? []).filter((r) => r.vendorRead === 'failed'), null, 2));

  console.log(`\nreportNote: ${result.reportNote ?? ''}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
