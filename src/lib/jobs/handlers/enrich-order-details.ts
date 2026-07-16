import { db } from '@/lib/db/client';
import { orders, orderProperties } from '@/lib/db/schema';
import { and, asc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { getOrderDetails } from '@/lib/integrations/softpro';
import {
  loadEscrowOfficers,
  loadSalesReps,
  loadTitleOfficers,
  processOrderDetail,
} from '@/lib/domain/orders/process-detail';

export interface EnrichOrderDetailsResult {
  eligible: number;
  attempted: number;
  enriched: number;
  errors: Array<{ orderId: number; fileNumber: string; error: string }>;
  timedOut: boolean;
}

const TIME_BUDGET_MS = 240_000; // 4 min — leaves headroom under the 5-min route maxDuration
const BATCH_SIZE = 50;
const MAX_DETAILS_ATTEMPTS = 20;

/**
 * Per-order enrichment of softpro_sync orders missing GetOrderDetails-shaped
 * fields (address, sales rep, title officer, escrow officer). Mirrors the fetch-prelims
 * architecture: backlog-aware (asc lastDetailsFetchAt — NULLs first),
 * 6-hour cooldown after each attempt, fails loudly if SoftPro returns
 * zero successes across the run.
 */
export async function handleEnrichOrderDetails(): Promise<EnrichOrderDetailsResult> {
  const startTime = Date.now();
  const stats: EnrichOrderDetailsResult = {
    eligible: 0,
    attempted: 0,
    enriched: 0,
    errors: [],
    timedOut: false,
  };

  const candidates = await db
    .selectDistinct({
      id: orders.id,
      fileNumber: orders.fileNumber,
      lastDetailsFetchAt: orders.lastDetailsFetchAt,
    })
    .from(orders)
    .leftJoin(orderProperties, eq(orderProperties.orderId, orders.id))
    .where(and(
      eq(orders.source, 'softpro_sync'),
      sql`${orders.operationalStatus} in ('open', 'in_process', 'completed')`,
      or(
        isNull(orderProperties.address),
        isNull(orders.salesRepId),
        isNull(orders.titleOfficerId),
        isNull(orders.escrowOfficerId),
      ),
      lt(orders.detailsAttemptCount, MAX_DETAILS_ATTEMPTS),
      or(
        isNull(orders.lastDetailsFetchAt),
        sql`${orders.lastDetailsFetchAt} < NOW() - INTERVAL '6 hours'`,
      ),
    ))
    .orderBy(asc(orders.lastDetailsFetchAt))
    .limit(BATCH_SIZE);

  stats.eligible = candidates.length;

  if (candidates.length === 0) {
    return stats;
  }

  // Load officer caches once per run.
  const [salesReps, titleOfficers, escrowOfficers] = await Promise.all([
    loadSalesReps(),
    loadTitleOfficers(),
    loadEscrowOfficers(),
  ]);

  for (const order of candidates) {
    if (Date.now() - startTime > TIME_BUDGET_MS) {
      console.warn(
        `[enrich-order-details] Time budget exhausted after ${stats.attempted} of ${candidates.length} orders — exiting cleanly`,
      );
      stats.timedOut = true;
      break;
    }

    stats.attempted++;

    // Stamp the attempt BEFORE the call so a hang/failure still applies
    // the 6-hour cooldown and stops us re-polling the same dead file.
    await db.update(orders)
      .set({
        lastDetailsFetchAt: sql`NOW()`,
        detailsAttemptCount: sql`${orders.detailsAttemptCount} + 1`,
      })
      .where(eq(orders.id, order.id));

    try {
      const result = await getOrderDetails({
        dateFrom: '',
        orderNumber: order.fileNumber,
        orderId: order.id,
      });

      if (!result.success || !result.data || result.data.length === 0) {
        stats.errors.push({
          orderId: order.id,
          fileNumber: order.fileNumber,
          error: result.success ? 'No data returned' : (result.error?.message ?? 'Unknown error'),
        });
        continue;
      }

      // Prefer the exact file-number match in case SoftPro returns siblings.
      const detail = result.data.find((d) => d.OrderNumber === order.fileNumber) ?? result.data[0];

      await processOrderDetail(detail, {
        salesReps,
        titleOfficers,
        escrowOfficers,
        preserveExistingOnEmpty: true,
      });
      stats.enriched++;
    } catch (err) {
      stats.errors.push({
        orderId: order.id,
        fileNumber: order.fileNumber,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  // Fail loudly when every attempt errored — this is almost always SoftPro
  // being unreachable, and we want the job runner to mark the run failed so
  // it surfaces in the Operations Command Center instead of looking healthy.
  if (
    stats.attempted > 0
    && stats.enriched === 0
    && stats.errors.length === stats.attempted
  ) {
    throw new Error(
      `enrich_order_details: ${stats.attempted} attempts, 0 successes — SoftPro likely unreachable`,
    );
  }

  return stats;
}
