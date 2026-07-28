import { db } from '@/lib/db/client';
import { vendorApiLogs } from '@/lib/db/schema';
import { initiateSearch } from './service';
import { getSetting } from '@/lib/domain/settings/service';
import type { TitlePointSearchType } from '@/lib/integrations/titlepoint/types';

interface PropertyData {
  address: string;
  city: string;
  state: string;
  county: string;
  apn?: string | null;
  fips?: string | null;
}

interface AutoTriggerResult {
  initiated: number;
  failed: number;
  skipped?: boolean;
}

/**
 * Fire-and-forget TitlePoint searches after order creation (no pre-init session).
 * Initiates Geo, Tax, and Legal Vesting sequentially via initiateSearch —
 * each does createService + short-sync, then enqueues titlepoint.poll for
 * the titlepoint.drain cron (OC-2). Submit must not wait on full PDF gen.
 * Respects the titlepoint_shut_off admin setting.
 * Failures are logged but never propagated to the caller.
 */
export async function autoTriggerTitlePoint(
  orderId: number,
  _property: PropertyData,
): Promise<AutoTriggerResult> {
  const shutOff = await getSetting('titlepoint_shut_off');
  if (shutOff === 'true') {
    try {
      await db.insert(vendorApiLogs).values({
        vendor: 'titlepoint',
        operation: 'auto_trigger_skipped',
        orderId,
        requestId: `skip-${crypto.randomUUID()}`,
        startedAt: new Date(),
        endedAt: new Date(),
        success: true,
        requestMeta: { reason: 'titlepoint_shut_off setting is enabled' } as Record<string, unknown>,
      });
    } catch { /* logging should never fail the flow */ }
    return { initiated: 0, failed: 0, skipped: true };
  }

  const searchTypes: TitlePointSearchType[] = ['geo_address', 'tax', 'legal_vesting'];

  let initiated = 0;
  let failed = 0;

  for (const searchType of searchTypes) {
    try {
      const result = await initiateSearch(orderId, searchType, 'system:auto');
      if (result.success) {
        initiated++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
  }

  return { initiated, failed };
}
