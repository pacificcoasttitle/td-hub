import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleSyncContactType } from './sync-all-contacts';

const {
  fetchSyncContactRowsMock,
  getSyncContactLookupCodeMock,
  insertOnConflictDoUpdateMock,
  selectLimitMock,
  sortSyncContactRowsMock,
  syncContactRowsMock,
  updateWhereMock,
} = vi.hoisted(() => ({
  fetchSyncContactRowsMock: vi.fn(),
  getSyncContactLookupCodeMock: vi.fn((_: string, item: { LookupCode?: string }) => item.LookupCode ?? null),
  insertOnConflictDoUpdateMock: vi.fn(),
  selectLimitMock: vi.fn(),
  sortSyncContactRowsMock: vi.fn((_: string, items: unknown[]) => items),
  syncContactRowsMock: vi.fn(),
  updateWhereMock: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => ({})),
}));

vi.mock('@/lib/db/schema', () => ({
  contactSyncState: {
    entityType: 'contact_sync_state.entity_type',
    jobType: 'contact_sync_state.job_type',
    status: 'contact_sync_state.status',
    cursorLookupCode: 'contact_sync_state.cursor_lookup_code',
    lastSyncedAt: 'contact_sync_state.last_synced_at',
    lastStartedAt: 'contact_sync_state.last_started_at',
    lastCompletedAt: 'contact_sync_state.last_completed_at',
    nextAllowedAt: 'contact_sync_state.next_allowed_at',
    totalFetched: 'contact_sync_state.total_fetched',
    lastResult: 'contact_sync_state.last_result',
    lastError: 'contact_sync_state.last_error',
    updatedAt: 'contact_sync_state.updated_at',
  },
}));

vi.mock('@/lib/db/client', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: selectLimitMock,
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoUpdate: insertOnConflictDoUpdateMock,
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: updateWhereMock,
      })),
    })),
  },
}));

vi.mock('./sync-contacts', () => ({
  fetchSyncContactRows: fetchSyncContactRowsMock,
  getSyncContactLookupCode: getSyncContactLookupCodeMock,
  sortSyncContactRows: sortSyncContactRowsMock,
  syncContactRows: syncContactRowsMock,
}));

describe('handleSyncContactType incremental state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertOnConflictDoUpdateMock.mockResolvedValue(undefined);
    updateWhereMock.mockResolvedValue(undefined);
  });

  it('uses contact_sync_state.last_synced_at as modifiedSince', async () => {
    selectLimitMock.mockResolvedValueOnce([{
      entityType: 'Lender',
      cursorLookupCode: null,
      lastSyncedAt: new Date('2026-07-13T18:00:00.000Z'),
      lastCompletedAt: new Date('2026-07-13T18:30:00.000Z'),
      nextAllowedAt: null,
      totalFetched: 10,
    }]);
    fetchSyncContactRowsMock.mockResolvedValueOnce({ items: [], error: null });

    const result = await handleSyncContactType('softpro.sync_contacts.lender');

    expect(fetchSyncContactRowsMock).toHaveBeenCalledWith('Lender', {
      modifiedSince: '2026-07-13T18:00:00.000Z',
    });
    expect(result.status).toBe('completed');
    expect(result.processed).toBe(0);
  });
});
