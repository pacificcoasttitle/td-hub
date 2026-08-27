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
import { applySiteXPropertyFields } from '@/lib/domain/orders/apply-sitex-property';
import { propertyLookup } from '@/lib/integrations/sitex/client';
import { createDeadline } from '@/lib/jobs/time-budget';
import { syncWindow } from '@/lib/jobs/sync-window';

export interface SyncOrdersPayload {
  dateFrom?: string;
  dateTo?: string;
}

export interface SyncOrdersResult {
  totalFetched: number;
  created: number;
  updated: number;
  enriched: number;
  sitexEnriched: number;
  /** The window actually requested, so a run's coverage is auditable after the fact. */
  dateFrom: string;
  dateTo: string;
  /** True when the time budget ended the run before every fetched order was processed. */
  stoppedEarly: boolean;
  errors: Array<{ fileNumber: string; error: string }>;
}

/**
 * Sync orders from SoftPro.
 * Flow: GetOrders → for each NEW order → GetOrderContacts → enrich with contact data.
 * Then if address is available → SiteX property lookup → enrich order_properties.
 * Existing orders only get status + date updates (no re-fetch of contacts or SiteX).
 */
export async function handleSyncOrders(
  payload: SyncOrdersPayload = {}
): Promise<SyncOrdersResult> {
  const window = syncWindow();
  const dateFrom = payload.dateFrom ?? window.dateFrom;
  const dateTo = payload.dateTo ?? window.dateTo;

  const adapterResult = await getOrders({ dateFrom, dateTo });

  if (!adapterResult.success || !adapterResult.data) {
    return {
      totalFetched: 0, created: 0, updated: 0, enriched: 0, sitexEnriched: 0,
      dateFrom, dateTo, stoppedEarly: false,
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
  let sitexEnriched = 0;
  let stoppedEarly = false;
  const errors: Array<{ fileNumber: string; error: string }> = [];

  // A 7-day window fetches roughly 7x the rows a today-only run did. Almost all
  // are already known and cost one lookup each, but a burst of genuinely new
  // orders pulls contacts and SiteX per order, so the run is bounded rather than
  // risking the function ceiling. Stopping early is safe: the window is trailing,
  // so whatever is left is re-requested by the next run.
  const deadline = createDeadline('softpro.sync_recent_orders');

  for (const item of items) {
    if (deadline.exceeded()) {
      stoppedEarly = true;
      break;
    }
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

      if (result.created && mapped.property.address) {
        const didEnrich = await enrichWithSiteX(result.orderId, mapped.property);
        if (didEnrich) sitexEnriched++;
      }

      if (result.created) created++;
      else updated++;
    } catch (err) {
      errors.push({
        fileNumber: item.OrderNumber,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  return {
    totalFetched: items.length,
    created, updated, enriched, sitexEnriched,
    dateFrom, dateTo, stoppedEarly,
    errors,
  };
}

// ─── SiteX Enrichment ───────────────────────────────────────────────────────

async function enrichWithSiteX(
  orderId: number,
  property: { address: string | null; city: string | null; state: string | null }
): Promise<boolean> {
  if (!property.address) return false;

  try {
    const result = await propertyLookup({
      street: property.address,
      city: property.city ?? '',
      state: property.state ?? 'CA',
      zip: '',
    });

    if (!result.success || !result.data || result.data.matchCode !== 'S') {
      return false;
    }

    // Preserve-on-empty / never-overwrite — only fill blank parcel fields.
    const applied = await applySiteXPropertyFields(orderId, result.data);
    return applied.applied;
  } catch {
    return false;
  }
}
