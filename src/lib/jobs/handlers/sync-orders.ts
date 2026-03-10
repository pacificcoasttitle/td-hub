import { getOrderDetails, mapSoftProOrder } from '@/lib/integrations/softpro';
import { upsertFromSoftPro } from '@/lib/domain/orders/service';

export interface SyncOrdersPayload {
  dateFrom?: string;
  dateTo?: string;
}

export interface SyncOrdersResult {
  totalFetched: number;
  created: number;
  updated: number;
  errors: Array<{ fileNumber: string; error: string }>;
}

/**
 * Format a Date as MM-DD-YYYY for SoftPro API query parameters.
 */
function formatDateForSoftPro(d: Date): string {
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${month}-${day}-${d.getFullYear()}`;
}

/**
 * Sync recent orders from SoftPro via GetOrderDetails.
 * Maps each result and upserts into local orders + order_properties tables.
 * Idempotent: re-running updates existing orders without duplicating.
 */
export async function handleSyncOrders(
  payload: SyncOrdersPayload = {}
): Promise<SyncOrdersResult> {
  const now = new Date();
  const dateFrom = payload.dateFrom ?? formatDateForSoftPro(now);
  const dateTo = payload.dateTo ?? formatDateForSoftPro(now);

  const adapterResult = await getOrderDetails({ dateFrom, dateTo });

  if (!adapterResult.success || !adapterResult.data) {
    return {
      totalFetched: 0,
      created: 0,
      updated: 0,
      errors: [{
        fileNumber: '*',
        error: adapterResult.error?.message ?? 'Failed to fetch orders from SoftPro',
      }],
    };
  }

  const items = adapterResult.data;
  let created = 0;
  let updated = 0;
  const errors: Array<{ fileNumber: string; error: string }> = [];

  for (const item of items) {
    try {
      const mapped = mapSoftProOrder(item);
      const result = await upsertFromSoftPro(mapped);
      if (result.created) created++;
      else updated++;
    } catch (err) {
      errors.push({
        fileNumber: item.OrderNumber,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  return { totalFetched: items.length, created, updated, errors };
}
