import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CONTACT_SYNC_BATCH_LIMITS, handleSyncContactType } from './sync-all-contacts';

const {
  fetchSyncContactRowsMock,
  getSyncContactLookupCodeMock,
  insertOnConflictDoUpdateMock,
  selectLimitMock,
  sortSyncContactRowsMock,
  syncContactRowsMock,
  updateWhereMock,
  updateSets,
} = vi.hoisted(() => ({
  fetchSyncContactRowsMock: vi.fn(),
  getSyncContactLookupCodeMock: vi.fn((_: string, item: { LookupCode?: string }) => item.LookupCode ?? null),
  insertOnConflictDoUpdateMock: vi.fn(),
  selectLimitMock: vi.fn(),
  sortSyncContactRowsMock: vi.fn((_: string, items: unknown[]) => items),
  syncContactRowsMock: vi.fn(),
  updateWhereMock: vi.fn(),
  updateSets: [] as Record<string, unknown>[],
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => ({})),
}));

vi.mock('@/lib/db/schema', () => ({
  jobs: { id: 'jobs.id', error: 'jobs.error', payload: 'jobs.payload' },
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
      set: vi.fn((vals: Record<string, unknown>) => {
        updateSets.push(vals);
        return { where: updateWhereMock };
      }),
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

// ── A partial failure has to leave a trace ──────────────────────────────────
//
// syncContactRows collects per-row errors and returns normally, so the runner
// marks the job `completed` and writes no error. That is indistinguishable from
// a run that had nothing to do, and it is how the escrow-officer feed reported
// clean runs for four months while four officers stopped updating.
describe('partial failures surface', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateSets.length = 0;
    insertOnConflictDoUpdateMock.mockResolvedValue(undefined);
    updateWhereMock.mockResolvedValue(undefined);
    selectLimitMock.mockResolvedValue([]);
    sortSyncContactRowsMock.mockImplementation((_: string, items: unknown[]) => items);
  });

  /** Two rows on the feed, one of which collides. Not all of them, so the
   *  existing "0 successes" guard does not throw and we exercise the quiet path. */
  function oneFailureOfTwo() {
    fetchSyncContactRowsMock.mockResolvedValueOnce({
      items: [{ LookupCode: 'PCT\\aballesteros' }, { LookupCode: 'PCT\\cquintanar' }],
      error: null,
    });
    syncContactRowsMock.mockResolvedValueOnce({
      entityType: 'Escrow Officer',
      totalFetched: 2,
      created: 0,
      updated: 1,
      skipped: 0,
      errors: [{
        lookupCode: 'PCT\\aballesteros',
        error: 'unique violation on contacts_closer_examiner_uniq: this code already belongs to a different contacts row',
      }],
    });
  }

  it('writes the failure to jobs.error, where the Operations panel reads', async () => {
    oneFailureOfTwo();

    const result = await handleSyncContactType(
      'softpro.sync_contacts.escrow_officer',
      { __jobId: 4242 },
    );

    const jobUpdate = updateSets.find((s) => 'payload' in s);
    expect(jobUpdate).toBeDefined();
    expect(jobUpdate!.error).toContain('PCT\\aballesteros');
    expect(jobUpdate!.error).toContain('1 of 2 rows failed');
    expect(jobUpdate!.error).toContain('contacts_closer_examiner_uniq');
    expect((jobUpdate!.payload as Record<string, unknown>).syncContacts).toBeDefined();

    // Surfaced and continued: the run still reports its successful row.
    expect(result.updated).toBe(1);
    expect(result.status).toBe('completed');
  });

  it('stops nulling contact_sync_state.last_error on a run that failed rows', async () => {
    oneFailureOfTwo();

    await handleSyncContactType('softpro.sync_contacts.escrow_officer', { __jobId: 1 });

    const stateUpdate = updateSets.find((s) => 'lastResult' in s);
    expect(stateUpdate).toBeDefined();
    expect(stateUpdate!.lastError).toContain('PCT\\aballesteros');
  });

  it('leaves both clean when nothing failed', async () => {
    fetchSyncContactRowsMock.mockResolvedValueOnce({
      items: [{ LookupCode: 'PCT\\cquintanar' }],
      error: null,
    });
    syncContactRowsMock.mockResolvedValueOnce({
      entityType: 'Escrow Officer',
      totalFetched: 1,
      created: 0,
      updated: 1,
      skipped: 0,
      errors: [],
    });

    await handleSyncContactType('softpro.sync_contacts.escrow_officer', { __jobId: 9 });

    const stateUpdate = updateSets.find((s) => 'lastResult' in s);
    expect(stateUpdate!.lastError).toBeNull();
    const jobUpdate = updateSets.find((s) => 'payload' in s);
    expect(jobUpdate).toBeDefined();
    expect(jobUpdate).not.toHaveProperty('error');
  });

  it('records nothing on the job row when the runner passed no job id', async () => {
    oneFailureOfTwo();

    await handleSyncContactType('softpro.sync_contacts.escrow_officer');

    expect(updateSets.find((s) => 'payload' in s)).toBeUndefined();
    // The sync-state error is still recorded — that path needs no job id.
    expect(updateSets.find((s) => 'lastResult' in s)!.lastError).toContain('PCT\\aballesteros');
  });
});

// ── Batch sizing ────────────────────────────────────────────────────────────
// This job has no interruptible loop, so the batch size IS its time budget.
// These pin the sizing so nobody restores a value that runs past the ceiling.
describe('batch sizing', () => {
  const L = CONTACT_SYNC_BATCH_LIMITS;

  it('keeps a full batch inside the worst-case target', () => {
    expect(L.batchSize * L.measuredSecondsPerRow).toBeLessThanOrEqual(L.worstCaseTargetSeconds);
  });

  it('pins that the OLD 3,000 would have overrun the target', () => {
    // 3000 * 0.09 = 270s at target, and measured runs actually hit 237-288s
    // against a 300s ceiling — this is what produced the 95 watchdog kills.
    expect(3000 * L.measuredSecondsPerRow).toBeGreaterThanOrEqual(L.worstCaseTargetSeconds);
    expect(L.batchSize).toBeLessThan(3000);
  });

  it('leaves real headroom under the function ceiling', () => {
    const worst = L.batchSize * L.measuredSecondsPerRow;
    expect(L.functionCeilingSeconds - worst).toBeGreaterThanOrEqual(120);
  });
});
