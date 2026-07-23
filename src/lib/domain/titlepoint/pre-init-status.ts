import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { titlePointData } from '@/lib/db/schema';
import { PRE_INIT_SEARCH_TYPES } from './pre-initiate';

/** Terminal for the open-order submit gate (structured data captured or hard-failed). */
export const PRE_INIT_TERMINAL_STATUSES = new Set([
  'result_ready',
  'completed',
  'failed',
  'exception',
]);

export type PreInitSearchStatusRow = {
  searchType: string;
  status: string;
  hasTaxData: boolean;
  hasVestingData: boolean;
};

export type PreInitSessionStatus = {
  sessionId: string;
  searches: PreInitSearchStatusRow[];
  /** Both Tax + LV present and each in a terminal status. */
  ready: boolean;
  /** True when tax resultData is present on a terminal tax row. */
  taxDataCaptured: boolean;
};

function metaHasResultData(meta: unknown): boolean {
  if (!meta || typeof meta !== 'object') return false;
  const rd = (meta as Record<string, unknown>).resultData;
  return !!rd && typeof rd === 'object';
}

export async function getPreInitSessionStatus(sessionId: string): Promise<PreInitSessionStatus | null> {
  const rows = await db
    .select({
      searchType: titlePointData.searchType,
      status: titlePointData.status,
      metadata: titlePointData.metadata,
    })
    .from(titlePointData)
    .where(eq(titlePointData.sessionId, sessionId));

  if (rows.length === 0) return null;

  const byType = new Map<string, PreInitSearchStatusRow>();
  for (const row of rows) {
    if (!row.searchType) continue;
    const hasData = metaHasResultData(row.metadata);
    byType.set(row.searchType, {
      searchType: row.searchType,
      status: row.status ?? 'pending',
      hasTaxData: row.searchType === 'tax' && hasData,
      hasVestingData: row.searchType === 'legal_vesting' && hasData,
    });
  }

  const searches = PRE_INIT_SEARCH_TYPES.map((t) =>
    byType.get(t) ?? {
      searchType: t,
      status: 'missing',
      hasTaxData: false,
      hasVestingData: false,
    },
  );

  const ready = searches.every((s) => PRE_INIT_TERMINAL_STATUSES.has(s.status));
  const taxDataCaptured = searches.some((s) => s.hasTaxData);

  return { sessionId, searches, ready, taxDataCaptured };
}
