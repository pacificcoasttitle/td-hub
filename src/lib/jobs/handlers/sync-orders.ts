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
import { propertyLookup } from '@/lib/integrations/sitex/client';
import type { SiteXPropertyData } from '@/lib/integrations/sitex/types';
import { db } from '@/lib/db/client';
import { orderProperties } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

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
 * Then if address is available → SiteX property lookup → enrich order_properties.
 * Existing orders only get status + date updates (no re-fetch of contacts or SiteX).
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
      totalFetched: 0, created: 0, updated: 0, enriched: 0, sitexEnriched: 0,
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

  return { totalFetched: items.length, created, updated, enriched, sitexEnriched, errors };
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

    await applySiteXData(orderId, result.data);
    return true;
  } catch {
    return false;
  }
}

async function applySiteXData(orderId: number, data: SiteXPropertyData): Promise<void> {
  await db.update(orderProperties).set({
    apn: data.apn,
    legalDescription: data.legalDescription,
    county: data.county,
    propertyType: data.propertyType,
    primaryOwner: data.primaryOwner,
    secondaryOwner: data.secondaryOwner,
    updatedAt: new Date(),
  }).where(eq(orderProperties.orderId, orderId));
}
