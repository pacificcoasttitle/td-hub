import { db } from '@/lib/db/client';
import { orders } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { getOrderDetails } from '@/lib/integrations/softpro';
import {
  loadSalesReps,
  loadTitleOfficers,
  loadEscrowOfficers,
  processOrderDetail,
  resolveEscrowOfficerId,
} from '@/lib/domain/orders/process-detail';

// Re-export for backward compatibility with existing callers
// (e.g. src/app/api/admin/backfill/escrow-officers/route.ts).
export { loadEscrowOfficers, resolveEscrowOfficerId };

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ImportOrdersPayload {
  dateFrom: string;
  dateTo: string;
}

export interface ImportOrdersResult {
  total: number;
  imported: number;
  updated: number;
  errors: Array<{ fileNumber: string; error: string }>;
}

// ─── Main Handler ────────────────────────────────────────────────────────────
//
// Date-range import via SoftPro GetOrderDetails. This endpoint times out
// on large windows, which is why the recurring sync is now per-order via
// softpro.enrich_order_details. This handler remains available for manual
// backfills triggered with explicit date ranges.

export async function importOrdersFromSoftPro(
  payload: ImportOrdersPayload
): Promise<ImportOrdersResult> {
  const apiResult = await getOrderDetails({
    dateFrom: payload.dateFrom,
    dateTo: payload.dateTo,
  });

  if (!apiResult.success || !apiResult.data) {
    return {
      total: 0,
      imported: 0,
      updated: 0,
      errors: [{
        fileNumber: '*',
        error: apiResult.error?.message ?? 'GetOrderDetails failed or returned no data',
      }],
    };
  }

  const items = apiResult.data;
  if (items.length === 0) {
    return { total: 0, imported: 0, updated: 0, errors: [] };
  }

  const salesReps = await loadSalesReps();
  const titleOfficers = await loadTitleOfficers();
  const escrowOfficers = await loadEscrowOfficers();

  let imported = 0;
  let updated = 0;
  const errors: ImportOrdersResult['errors'] = [];

  for (const item of items) {
    try {
      const existedBefore = await db
        .select({ id: orders.id })
        .from(orders)
        .where(eq(orders.fileNumber, item.OrderNumber))
        .limit(1);

      // Existing rows upsert by file number — preserve type fields SoftPro omits.
      // First-insert path inside processOrderDetail ignores this flag.
      await processOrderDetail(item, {
        salesReps,
        titleOfficers,
        escrowOfficers,
        preserveExistingOnEmpty: true,
      });

      if (existedBefore.length > 0) {
        updated++;
      } else {
        imported++;
      }
    } catch (err) {
      errors.push({
        fileNumber: item.OrderNumber ?? 'unknown',
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  return { total: items.length, imported, updated, errors };
}
