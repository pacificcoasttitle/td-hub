import { db } from '@/lib/db/client';
import { titlePointData, jobs, vendorApiLogs } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { createService } from '@/lib/integrations/titlepoint/client';
import { fetchImage } from './service';
import { fetchGrantDeed } from './grant-deed';
import { maybeEnqueueConfirmation } from './completion-checker';
import { getSetting } from '@/lib/domain/settings/service';
import type { TitlePointSearchType } from '@/lib/integrations/titlepoint/types';

const SEARCH_TYPES: TitlePointSearchType[] = ['geo_address', 'tax', 'legal_vesting'];

interface PreInitiateResult {
  sessionId: string;
  searches: Array<{ searchType: string; status: string }>;
  skipped?: boolean;
}

export async function preInitiateSearches(property: {
  address: string;
  city: string;
  state: string;
  county: string;
  apn: string | null;
}): Promise<PreInitiateResult> {
  const sessionId = `tp_pre_${crypto.randomUUID()}`;

  const shutOff = await getSetting('titlepoint_shut_off');
  if (shutOff === 'true') {
    try {
      await db.insert(vendorApiLogs).values({
        vendor: 'titlepoint',
        operation: 'pre_initiate_skipped',
        requestId: `skip-${crypto.randomUUID()}`,
        startedAt: new Date(),
        endedAt: new Date(),
        success: true,
        requestMeta: { reason: 'titlepoint_shut_off', sessionId } as Record<string, unknown>,
      });
    } catch { /* logging never blocks */ }
    return { sessionId, searches: [], skipped: true };
  }

  const searches: PreInitiateResult['searches'] = [];

  const results = await Promise.allSettled(
    SEARCH_TYPES.map(async (searchType) => {
      const result = await createService(
        {
          address: property.address,
          city: property.city,
          state: property.state,
          county: property.county,
          fips: undefined,
          searchType,
        },
      );

      if (!result.success) {
        await db.insert(titlePointData).values({
          sessionId,
          searchType,
          status: 'failed',
          message: result.error?.message ?? 'CreateService failed',
          metadata: { property } as Record<string, unknown>,
        });
        return { searchType, status: 'failed' };
      }

      const tpData = result.data!;
      const [record] = await db
        .insert(titlePointData)
        .values({
          sessionId,
          requestId: tpData.requestId,
          searchType,
          status: 'pending',
          metadata: { property, tpOrderId: tpData.orderId, userId: 'system:pre_init' } as Record<string, unknown>,
        })
        .returning({ id: titlePointData.id });

      await db.insert(jobs).values({
        jobType: 'titlepoint.poll',
        payload: { titlePointDataId: record!.id } as Record<string, unknown>,
        status: 'queued',
        nextRetryAt: new Date(Date.now() + 30_000),
      });

      return { searchType, status: 'initiated' };
    }),
  );

  for (const r of results) {
    if (r.status === 'fulfilled') {
      searches.push(r.value);
    }
  }

  return { sessionId, searches };
}

export async function linkSessionToOrder(
  sessionId: string,
  orderId: number,
  fileNumber: string,
): Promise<{ linked: number; finished: number }> {
  const rows = await db
    .select({ id: titlePointData.id, status: titlePointData.status, searchType: titlePointData.searchType })
    .from(titlePointData)
    .where(eq(titlePointData.sessionId, sessionId));

  if (rows.length === 0) return { linked: 0, finished: 0 };

  await db
    .update(titlePointData)
    .set({ orderId, fileNumber, updatedAt: new Date() })
    .where(eq(titlePointData.sessionId, sessionId));

  let finished = 0;
  for (const row of rows) {
    if (row.status !== 'result_ready') continue;

    try {
      const imgResult = await fetchImage(row.id);
      if (imgResult.success) finished++;

      if (row.searchType === 'legal_vesting') {
        try { await fetchGrantDeed(row.id); } catch { /* non-blocking */ }
      }
    } catch { /* non-blocking */ }
  }

  if (finished > 0) {
    try { await maybeEnqueueConfirmation(orderId); } catch { /* non-blocking */ }
  }

  return { linked: rows.length, finished };
}
