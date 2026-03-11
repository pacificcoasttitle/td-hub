import {
  getOrders,
  getOrderContacts,
  mapSoftProOrder,
  mapOrderContacts,
} from '@/lib/integrations/softpro';
import {
  upsertFromSoftPro,
  getOrderByFileNumber,
} from '@/lib/domain/orders/service';

export interface SyncOrdersPayload {
  dateFrom?: string;
  dateTo?: string;
}

export interface SyncOrdersResult {
  totalFetched: number;
  created: number;
  updated: number;
  enriched: number;
  errors: Array<{ fileNumber: string; error: string }>;
}

function formatDateForSoftPro(d: Date): string {
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${month}-${day}-${d.getFullYear()}`;
}

/**
 * Sync orders from SoftPro.
 * Flow: GetOrders → for each NEW order → GetOrderContacts → enrich with contact data.
 * Existing orders only get status + date updates from GetOrders (no re-fetch of contacts).
 */
export async function handleSyncOrders(
  payload: SyncOrdersPayload = {}
): Promise<SyncOrdersResult> {
  const now = new Date();
  const dateFrom = payload.dateFrom ?? formatDateForSoftPro(now);
  const dateTo = payload.dateTo ?? formatDateForSoftPro(now);

  const adapterResult = await getOrders({ dateFrom, dateTo });

  if (!adapterResult.success || !adapterResult.data) {
    return {
      totalFetched: 0,
      created: 0,
      updated: 0,
      enriched: 0,
      errors: [{
        fileNumber: '*',
        error: adapterResult.error?.message ?? 'Failed to fetch orders from SoftPro',
      }],
    };
  }

  const items = adapterResult.data;
  let created = 0;
  let updated = 0;
  let enriched = 0;
  const errors: Array<{ fileNumber: string; error: string }> = [];

  for (const item of items) {
    try {
      const existing = await getOrderByFileNumber(item.OrderNumber);
      const mapped = mapSoftProOrder(item);

      if (!existing) {
        const contactsResult = await getOrderContacts(item.OrderNumber);
        if (contactsResult.success && contactsResult.data) {
          const contacts = mapOrderContacts(contactsResult.data);
          mapped.titleOfficerName = contacts.titleOfficerName;
          enriched++;
        }
      }

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

  return { totalFetched: items.length, created, updated, enriched, errors };
}
