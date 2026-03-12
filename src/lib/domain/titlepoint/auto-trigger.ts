import { db } from '@/lib/db/client';
import { jobs } from '@/lib/db/schema';
import { initiateSearch } from './service';
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
}

/**
 * Fire-and-forget TitlePoint searches after order creation.
 * Initiates Geo, Tax, and Legal Vesting searches in parallel.
 * Failures are logged but never propagated to the caller.
 */
export async function autoTriggerTitlePoint(
  orderId: number,
  property: PropertyData,
): Promise<AutoTriggerResult> {
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
