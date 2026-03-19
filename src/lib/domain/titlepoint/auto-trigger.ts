import { db } from '@/lib/db/client';
import { jobs, vendorApiLogs } from '@/lib/db/schema';
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
 * Fire-and-forget TitlePoint searches after order creation.
 * Initiates Geo, Tax, and Legal Vesting searches in parallel.
 * Respects the titlepoint_shut_off admin setting.
 * Failures are logged but never propagated to the caller.
 */
export async function autoTriggerTitlePoint(
  orderId: number,
  property: PropertyData,
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

  const results = await Promise.allSettled(
    searchTypes.map(async (searchType) => {
      const result = await initiateSearch(orderId, searchType, 'system:auto');
      if (!result.success) {
        throw new Error(result.error ?? `${searchType} initiation failed`);
      }
      if (result.titlePointDataId) {
        await enqueuePoll(result.titlePointDataId);
      }
      return result;
    })
  );

  let initiated = 0;
  let failed = 0;
  for (const r of results) {
    if (r.status === 'fulfilled') initiated++;
    else failed++;
  }

  return { initiated, failed };
}

async function enqueuePoll(titlePointDataId: number): Promise<void> {
  await db.insert(jobs).values({
    jobType: 'titlepoint.poll',
    payload: { titlePointDataId } as Record<string, unknown>,
    status: 'queued',
    nextRetryAt: new Date(Date.now() + 30_000),
  });
}
