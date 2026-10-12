/**
 * READ ONLY. Every HTTP status the Concierge feed call has ever come back with.
 *
 * Asked because "SiteX returned HTTP 300" turned up on a generate attempt and
 * the question is whether operators have been hitting it and giving up. A 300
 * is SiteX saying "that address matches more than one property" — a normal
 * answer that the feed client classifies as an API error.
 *
 * NO VENDOR CALL. Reads vendor_api_logs only.
 *
 * NOTE ON JOINING THESE ROWS TO ANYTHING: vendor_api_logs.request_id is OUR
 * uuid, generated per call. It is not a vendor identifier and will not join to
 * one. sitex_search_id is the handle that reconciles against an invoice.
 *
 *   npx tsx --env-file=.env.local scripts/audit/concierge-http-status-counts.ts
 */
import { desc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { vendorApiLogs } from '@/lib/db/schema/integrations';

async function main() {
  const rows = await db
    .select({
      createdAt: vendorApiLogs.createdAt,
      success: vendorApiLogs.success,
      errorCategory: vendorApiLogs.errorCategory,
      requestMeta: vendorApiLogs.requestMeta,
      responseMeta: vendorApiLogs.responseMeta,
    })
    .from(vendorApiLogs)
    .where(eq(vendorApiLogs.operation, 'concierge_profile'))
    .orderBy(desc(vendorApiLogs.createdAt));

  console.log(`\n${rows.length} concierge_profile call(s) logged.\n`);

  const byStatus = new Map<string, number>();
  const byCategory = new Map<string, number>();
  const threeHundreds: string[] = [];

  for (const r of rows) {
    const res = (r.responseMeta ?? {}) as Record<string, unknown>;
    const req = (r.requestMeta ?? {}) as Record<string, unknown>;
    const status = res.httpStatus === undefined || res.httpStatus === null
      ? (r.success ? '200 (not recorded)' : 'no status')
      : String(res.httpStatus);
    byStatus.set(status, (byStatus.get(status) ?? 0) + 1);
    const cat = r.errorCategory ?? (r.success ? '(success)' : '(none)');
    byCategory.set(cat, (byCategory.get(cat) ?? 0) + 1);

    if (String(res.httpStatus) === '300') {
      const when = r.createdAt instanceof Date ? r.createdAt.toISOString().slice(0, 16) : String(r.createdAt);
      const body = typeof res.body === 'string' ? res.body : '';
      // How many candidates did SiteX offer? The body is truncated to 400
      // chars in the log, so this counts what survived rather than the truth.
      const locs = (body.match(/"APN"/g) ?? []).length;
      threeHundreds.push(
        `    ${when}  ${String(req.lastLine ?? '')}  `
        + `credits=${String(res.creditsCharged ?? '?')}  APNs visible in logged body: ${locs}`,
      );
    }
  }

  console.log('  by HTTP status');
  for (const [k, v] of [...byStatus].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(v).padStart(4)}  ${k}`);
  }

  console.log('\n  by error category');
  for (const [k, v] of [...byCategory].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(v).padStart(4)}  ${k}`);
  }

  if (threeHundreds.length > 0) {
    console.log(`\n  the ${threeHundreds.length} multi-match(es), newest first`);
    for (const line of threeHundreds) console.log(line);
  } else {
    console.log('\n  no 300 ever logged on this operation.');
  }

  // Did a 300 ever charge? It should not — creditsCharged is response.ok ? 1 : 0.
  const charged = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(vendorApiLogs)
    .where(sql`${vendorApiLogs.operation} = 'concierge_profile'
      and ${vendorApiLogs.responseMeta}->>'httpStatus' = '300'
      and coalesce((${vendorApiLogs.responseMeta}->>'creditsCharged')::int, 0) > 0`);
  console.log(`\n  300s that charged a credit: ${charged[0]?.n ?? 0}  (expected 0)\n`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
