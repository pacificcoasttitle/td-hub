import { db } from '@/lib/db/client';
import { orders, orderProperties } from '@/lib/db/schema';
import { applySiteXPropertyFields } from '@/lib/domain/orders/apply-sitex-property';
import { propertyLookup } from '@/lib/integrations/sitex/client';
import { budgetMsFor } from '@/lib/jobs/time-budget';
import { and, asc, eq, isNull, lt, or, sql } from 'drizzle-orm';

export interface BackfillSitexPropertyResult {
  eligible: number;
  attempted: number;
  filled: number;
  noMatch: number;
  errors: Array<{ orderId: number; fileNumber: string; error: string }>;
  timedOut: boolean;
}

/** ~5s/SiteX call → ~40 fits under a 4-minute budget with headroom. */
// Sized from the measured p99 of one SiteX lookup — see
// src/lib/jobs/time-budget.ts. This job's units are short, so its budget is
// the most generous of the set.
const TIME_BUDGET_MS = budgetMsFor('sitex.backfill_property');
const BATCH_SIZE = 40;
const MAX_SITEX_ATTEMPTS = 8;
/**
 * Throttled SiteX backfill for SoftPro-synced orders missing parcel fields
 * (apn, legal_description, property_type). Zip is preferably filled free via
 * SoftPro GetOrderDetails; SiteX zip is only used as a secondary fill when blank.
 *
 * Idempotent: only fills blank fields; never overwrites; caps attempt rate.
 */
export async function handleBackfillSitexProperty(): Promise<BackfillSitexPropertyResult> {
  const startTime = Date.now();
  const stats: BackfillSitexPropertyResult = {
    eligible: 0,
    attempted: 0,
    filled: 0,
    noMatch: 0,
    errors: [],
    timedOut: false,
  };

  const missingParcelField = or(
    sql`(${orderProperties.apn} is null or trim(${orderProperties.apn}) = '')`,
    sql`(${orderProperties.legalDescription} is null or trim(${orderProperties.legalDescription}) = '')`,
    sql`(${orderProperties.propertyType} is null or trim(${orderProperties.propertyType}) = '')`,
  );

  const candidates = await db
    .select({
      id: orders.id,
      fileNumber: orders.fileNumber,
      address: orderProperties.address,
      city: orderProperties.city,
      state: orderProperties.state,
      zip: orderProperties.zip,
      lastSitexFetchAt: orders.lastSitexFetchAt,
    })
    .from(orders)
    .innerJoin(orderProperties, eq(orderProperties.orderId, orders.id))
    .where(and(
      eq(orders.source, 'softpro_sync'),
      sql`${orders.operationalStatus} in ('open', 'in_process', 'completed')`,
      sql`(${orderProperties.address} is not null and trim(${orderProperties.address}) <> '')`,
      missingParcelField,
      lt(orders.sitexAttemptCount, MAX_SITEX_ATTEMPTS),
      or(
        isNull(orders.lastSitexFetchAt),
        sql`${orders.lastSitexFetchAt} < NOW() - INTERVAL '12 hours'`,
      ),
    ))
    .orderBy(asc(orders.lastSitexFetchAt))
    .limit(BATCH_SIZE);

  stats.eligible = candidates.length;
  if (candidates.length === 0) return stats;

  for (const order of candidates) {
    if (Date.now() - startTime > TIME_BUDGET_MS) {
      console.warn(
        `[backfill-sitex-property] Time budget exhausted after ${stats.attempted} of ${candidates.length} orders — exiting cleanly`,
      );
      stats.timedOut = true;
      break;
    }

    stats.attempted++;

    // Stamp before the call so hangs/failures still apply cooldown.
    await db.update(orders)
      .set({
        lastSitexFetchAt: sql`NOW()`,
        sitexAttemptCount: sql`${orders.sitexAttemptCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(orders.id, order.id));

    try {
      const result = await propertyLookup({
        street: order.address!,
        city: order.city ?? '',
        state: order.state ?? 'CA',
        zip: order.zip ?? '',
      });

      if (!result.success || !result.data || result.data.matchCode !== 'S') {
        stats.noMatch++;
        if (!result.success) {
          stats.errors.push({
            orderId: order.id,
            fileNumber: order.fileNumber,
            error: result.error?.message ?? 'SiteX lookup failed',
          });
        }
        continue;
      }

      const applied = await applySiteXPropertyFields(order.id, result.data);
      if (applied.applied) stats.filled++;
    } catch (err) {
      stats.errors.push({
        orderId: order.id,
        fileNumber: order.fileNumber,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  return stats;
}
