import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleSyncContactType, MAX_PAGES_PER_RUN } from './sync-all-contacts';
import { budgetMsFor, FUNCTION_CEILING_MS, UNIT_P99_MS } from '@/lib/jobs/time-budget';

const {
  fetchSyncContactPageMock,
  fetchSyncContactRowsMock,
  insertOnConflictDoUpdateMock,
  selectLimitMock,
  syncContactRowsMock,
  updateWhereMock,
  updateSets,
  clock,
} = vi.hoisted(() => ({
  fetchSyncContactPageMock: vi.fn(),
  fetchSyncContactRowsMock: vi.fn(),
  insertOnConflictDoUpdateMock: vi.fn(),
  selectLimitMock: vi.fn(),
  syncContactRowsMock: vi.fn(),
  updateWhereMock: vi.fn(),
  updateSets: [] as Record<string, unknown>[],
  clock: { t: Date.parse('2026-09-15T18:00:00Z') },
}));

vi.mock('drizzle-orm', () => ({ eq: vi.fn(() => ({})) }));

vi.mock('@/lib/db/schema', () => ({
  jobs: { id: 'jobs.id', error: 'jobs.error', payload: 'jobs.payload' },
  contactSyncState: { entityType: 'contact_sync_state.entity_type' },
}));

vi.mock('@/lib/db/client', () => ({
  db: {
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: selectLimitMock })) })) })),
    insert: vi.fn(() => ({ values: vi.fn(() => ({ onConflictDoUpdate: insertOnConflictDoUpdateMock })) })),
    update: vi.fn(() => ({
      set: vi.fn((vals: Record<string, unknown>) => {
        updateSets.push(vals);
        return { where: updateWhereMock };
      }),
    })),
  },
}));

vi.mock('./sync-contacts', () => ({
  describeSyncError: (err: unknown) => (err instanceof Error ? err.message : 'Unknown'),
  fetchSyncContactPage: fetchSyncContactPageMock,
  fetchSyncContactRows: fetchSyncContactRowsMock,
  getSyncContactLookupCode: (_: string, item: { LookupCode?: string }) => item.LookupCode ?? null,
  sortSyncContactRows: (_: string, items: Array<{ LookupCode?: string }>) =>
    [...items].sort((a, b) => (a.LookupCode ?? '').localeCompare(b.LookupCode ?? '')),
  syncContactRows: syncContactRowsMock,
}));

const now = () => clock.t;
const PERSON = 'softpro.sync_contacts.order_contact_person' as const;
const OFFICER = 'softpro.sync_contacts.escrow_officer' as const;

/** A page of rows whose codes sort within that page, like SoftPro's. */
function pageOf(page: number, size = 3) {
  return Array.from({ length: size }, (_, i) => ({ LookupCode: `P${String(page).padStart(2, '0')}-${i}` }));
}

/** Each fetch takes `secs` of clock time, and returns that page of `totalPages`. */
function vendorPages(secs: number, totalPages = 16, totalRows = 15_643) {
  fetchSyncContactPageMock.mockImplementation(async (_: string, page: number) => {
    clock.t += secs * 1000;
    return { items: pageOf(page), totalPages, totalRows, error: null };
  });
}

function cleanWrite(n = 3) {
  syncContactRowsMock.mockImplementation(async (entityType: string, rows: unknown[]) => ({
    entityType, totalFetched: rows.length, created: 0, updated: n > 0 ? 1 : 0, skipped: 0, errors: [],
  }));
}

function midSweep(overrides: Record<string, unknown> = {}) {
  return {
    entityType: 'Order Contact - Person',
    status: 'paused',
    nextAllowedAt: null,
    lastStartedAt: new Date(clock.t - 60 * 60 * 1000),
    nextPage: 5,
    totalPages: 16,
    cursorLookupCode: 'P04-2',
    sweepStartedAt: new Date(clock.t - 2 * 60 * 60 * 1000),
    sweepTotalRows: 15_643,
    driftSuspected: false,
    totalFetched: 0,
    ...overrides,
  };
}

const cursorSaves = () => updateSets.filter((s) => 'nextPage' in s);
const finalState = () => updateSets.filter((s) => 'lastResult' in s).at(-1)!;

beforeEach(() => {
  vi.clearAllMocks();
  updateSets.length = 0;
  clock.t = Date.parse('2026-09-15T18:00:00Z');
  insertOnConflictDoUpdateMock.mockResolvedValue(undefined);
  updateWhereMock.mockResolvedValue(undefined);
  cleanWrite();
});

describe('the sync resumes across runs', () => {
  it('starts at next_page and saves the cursor after EACH page, not at the end', async () => {
    selectLimitMock.mockResolvedValueOnce([midSweep()]);
    vendorPages(70);

    const result = await handleSyncContactType(PERSON, {}, { now });

    // 70s pages against a 145s budget: pages start at 0s, 70s and 140s; the
    // fourth would start at 210s and does not.
    expect(fetchSyncContactPageMock.mock.calls.map((c) => c[1])).toEqual([5, 6, 7]);
    expect(cursorSaves().map((s) => s.nextPage)).toEqual([6, 7, 8]);
    expect(cursorSaves().map((s) => s.cursorLookupCode)).toEqual(['P05-2', 'P06-2', 'P07-2']);
    expect(result).toMatchObject({ status: 'paused', pagesRead: 3, nextPage: 8, sweepCompleted: false });
  });

  it('never starts a page after the deadline, even at the slowest page observed', async () => {
    selectLimitMock.mockResolvedValueOnce([midSweep()]);
    vendorPages(95.4);

    await handleSyncContactType(PERSON, {}, { now });

    // 0s, 95.4s — the third would start at 190.8s, past the 145s budget.
    expect(fetchSyncContactPageMock).toHaveBeenCalledTimes(2);
    expect(clock.t - Date.parse('2026-09-15T18:00:00Z')).toBeLessThan(FUNCTION_CEILING_MS);
  });

  it('never reads more than six pages in one run, however fast SoftPro is', async () => {
    selectLimitMock.mockResolvedValueOnce([midSweep()]);
    vendorPages(1);

    await handleSyncContactType(PERSON, {}, { now });

    expect(fetchSyncContactPageMock).toHaveBeenCalledTimes(MAX_PAGES_PER_RUN);
  });

  it('finishes the sweep at TotalPages, resets to page 1, and stamps the sweep', async () => {
    const sweepStartedAt = new Date(clock.t - 5 * 60 * 60 * 1000);
    selectLimitMock.mockResolvedValueOnce([midSweep({ nextPage: 16, cursorLookupCode: 'P15-2', sweepStartedAt })]);
    vendorPages(70);

    const result = await handleSyncContactType(PERSON, {}, { now });

    expect(fetchSyncContactPageMock).toHaveBeenCalledTimes(1);
    const save = cursorSaves()[0]!;
    expect(save).toMatchObject({ nextPage: 1, cursorLookupCode: null, sweepStartedAt: null, lastSyncedAt: sweepStartedAt });
    expect(save.lastSweepCompletedAt).toBeInstanceOf(Date);
    expect(result).toMatchObject({ status: 'completed', sweepCompleted: true, nextPage: 1 });
  });

  it('starts a fresh sweep at page 1 when there is no sweep marker', async () => {
    selectLimitMock.mockResolvedValueOnce([midSweep({ nextPage: 9, sweepStartedAt: null, cursorLookupCode: 'STALE' })]);
    vendorPages(70);

    await handleSyncContactType(PERSON, {}, { now });

    expect(fetchSyncContactPageMock.mock.calls[0]![1]).toBe(1);
    expect(cursorSaves()[0]).toMatchObject({ nextPage: 2, sweepTotalRows: 15_643 });
    expect(cursorSaves()[0]!.sweepStartedAt).toBeInstanceOf(Date);
  });

  it('keeps the cursor at the failed page, and puts no cooldown on the retry', async () => {
    selectLimitMock.mockResolvedValueOnce([midSweep()]);
    fetchSyncContactPageMock
      .mockImplementationOnce(async () => { clock.t += 70_000; return { items: pageOf(5), totalPages: 16, totalRows: 15_643, error: null }; })
      .mockImplementationOnce(async () => { clock.t += 120_000; return { items: [], totalPages: null, totalRows: null, error: 'The operation was aborted due to timeout' }; });

    await expect(handleSyncContactType(PERSON, {}, { now })).rejects.toThrow('page 6: The operation was aborted due to timeout');

    // Page 5's progress was saved before page 6 failed.
    expect(cursorSaves().map((s) => s.nextPage)).toEqual([6]);
    const failed = updateSets.find((s) => s.status === 'failed')!;
    expect(failed.nextAllowedAt).toBeNull();
    expect(failed.lastError).toContain('page 6');
  });

  it('treats an empty page before TotalPages as a failure, never the end of the data', async () => {
    selectLimitMock.mockResolvedValueOnce([midSweep()]);
    fetchSyncContactPageMock.mockResolvedValueOnce({ items: [], totalPages: 16, totalRows: 15_643, error: null });

    await expect(handleSyncContactType(PERSON, {}, { now })).rejects.toThrow('page 5 of 16 came back empty');
    expect(cursorSaves()).toHaveLength(0);
  });
});

describe('page drift', () => {
  it('records suspected drift when TotalRows falls during the sweep', async () => {
    selectLimitMock.mockResolvedValueOnce([midSweep({ sweepTotalRows: 15_643 })]);
    vendorPages(70, 16, 15_642);

    const result = await handleSyncContactType(PERSON, {}, { now });

    expect(cursorSaves()[0]!.driftSuspected).toBe(true);
    expect(result.driftSuspected).toBe(true);
  });

  it('counts a first code that does not sort after the boundary as a re-read, not drift', async () => {
    selectLimitMock.mockResolvedValueOnce([midSweep({ cursorLookupCode: 'P05-1' })]);
    vendorPages(200);

    const result = await handleSyncContactType(PERSON, {}, { now });

    expect(result.boundaryShifts).toBe(1);
    expect(result.driftSuspected).toBe(false);
  });
});

describe('one run at a time per entity type', () => {
  it('skips while another run started within the function ceiling still owns the sweep', async () => {
    selectLimitMock.mockResolvedValueOnce([midSweep({ status: 'running', lastStartedAt: new Date(clock.t - 60_000) })]);

    const result = await handleSyncContactType(PERSON, {}, { now });

    expect(result).toMatchObject({ status: 'skipped', skipReason: 'running' });
    expect(fetchSyncContactPageMock).not.toHaveBeenCalled();
  });

  it('takes over a run that has been "running" longer than any run can live', async () => {
    selectLimitMock.mockResolvedValueOnce([midSweep({ status: 'running', lastStartedAt: new Date(clock.t - 20 * 60_000) })]);
    vendorPages(200);

    const result = await handleSyncContactType(PERSON, {}, { now });

    expect(result.status).toBe('paused');
    expect(fetchSyncContactPageMock).toHaveBeenCalledTimes(1);
  });
});

// ── A partial failure has to leave a trace ──────────────────────────────────
//
// syncContactRows collects per-row errors and returns normally, so the runner
// marks the job `completed` and writes no error. That is indistinguishable from
// a run that had nothing to do, and it is how the escrow-officer feed reported
// clean runs for four months while four officers stopped updating.
describe('partial failures surface', () => {
  const onePageFeed = (items: Array<{ LookupCode: string }>) => {
    selectLimitMock.mockResolvedValueOnce([]);
    fetchSyncContactPageMock.mockResolvedValueOnce({ items, totalPages: 1, totalRows: items.length, error: null });
  };

  function oneFailureOfTwo() {
    onePageFeed([{ LookupCode: 'PCT\\aballesteros' }, { LookupCode: 'PCT\\cquintanar' }]);
    syncContactRowsMock.mockResolvedValueOnce({
      entityType: 'Escrow Officer', totalFetched: 2, created: 0, updated: 1, skipped: 0,
      errors: [{
        lookupCode: 'PCT\\aballesteros',
        error: 'unique violation on contacts_closer_examiner_uniq: this code already belongs to a different contacts row',
      }],
    });
  }

  it('writes the failure to jobs.error, where the Operations panel reads', async () => {
    oneFailureOfTwo();

    const result = await handleSyncContactType(OFFICER, { __jobId: 4242 }, { now });

    const jobUpdate = updateSets.find((s) => 'payload' in s)!;
    expect(jobUpdate.error).toContain('PCT\\aballesteros');
    expect(jobUpdate.error).toContain('1 of 2 rows failed');
    expect((jobUpdate.payload as Record<string, unknown>).syncContacts).toBeDefined();
    expect(result.updated).toBe(1);
    expect(result.status).toBe('completed');
  });

  it('does not null contact_sync_state.last_error on a run that failed rows', async () => {
    oneFailureOfTwo();
    await handleSyncContactType(OFFICER, { __jobId: 1 }, { now });
    expect(finalState().lastError).toContain('PCT\\aballesteros');
  });

  it('leaves both clean when nothing failed', async () => {
    onePageFeed([{ LookupCode: 'PCT\\cquintanar' }]);
    await handleSyncContactType(OFFICER, { __jobId: 9 }, { now });
    expect(finalState().lastError).toBeNull();
    expect(updateSets.find((s) => 'payload' in s)).not.toHaveProperty('error');
  });

  it('records nothing on the job row when the runner passed no job id', async () => {
    oneFailureOfTwo();
    await handleSyncContactType(OFFICER, {}, { now });
    expect(updateSets.find((s) => 'payload' in s)).toBeUndefined();
    expect(finalState().lastError).toContain('PCT\\aballesteros');
  });
});

// ── A shape rejection has to survive the next run ───────────────────────────
describe('shape rejections surface and persist', () => {
  function onlyGomezRejected() {
    selectLimitMock.mockResolvedValueOnce([]);
    fetchSyncContactPageMock.mockResolvedValueOnce({ items: [{ LookupCode: 'PCT\\jgomez' }], totalPages: 1, totalRows: 1, error: null });
    syncContactRowsMock.mockResolvedValueOnce({
      entityType: 'Escrow Officer', totalFetched: 1, created: 0, updated: 0, skipped: 0,
      errors: [{ lookupCode: 'PCT\\jgomez', error: "officer feed row for PCT\\jgomez REJECTED for shape (not imported). Escalate to SoftPro." }],
      rejected: [{ lookupCode: 'PCT\\jgomez', reasons: ["column 'Row State' is absent from the row"] }],
    });
  }

  it('does not clear last_error at the start of a run', async () => {
    onlyGomezRejected();
    await handleSyncContactType(OFFICER, { __jobId: 7 }, { now });
    const runStart = insertOnConflictDoUpdateMock.mock.calls[0]![0] as { set: Record<string, unknown> };
    expect(runStart.set.status).toBe('running');
    expect(runStart.set).not.toHaveProperty('lastError');
  });

  it('does not treat a rejection as the systemic "0 successes" failure', async () => {
    onlyGomezRejected();
    const result = await handleSyncContactType(OFFICER, { __jobId: 8 }, { now });
    expect(result.status).toBe('completed');
    expect(result.rejected).toHaveLength(1);
  });

  it('names the rejected officer on jobs.error and last_error, and says escalate', async () => {
    onlyGomezRejected();
    await handleSyncContactType(OFFICER, { __jobId: 11 }, { now });
    for (const message of [updateSets.find((s) => 'payload' in s)!.error, finalState().lastError] as string[]) {
      expect(message).toContain('PCT\\jgomez');
      expect(message).toContain('REJECTED FOR SHAPE');
    }
  });

  it('still trips the tripwire when every attempted row genuinely failed', async () => {
    selectLimitMock.mockResolvedValueOnce([]);
    fetchSyncContactPageMock.mockResolvedValueOnce({
      items: [{ LookupCode: 'PCT\\jgomez' }, { LookupCode: 'PCT\\aballesteros' }], totalPages: 1, totalRows: 2, error: null,
    });
    syncContactRowsMock.mockResolvedValueOnce({
      entityType: 'Escrow Officer', totalFetched: 2, created: 0, updated: 0, skipped: 0,
      errors: [
        { lookupCode: 'PCT\\jgomez', error: 'REJECTED for shape' },
        { lookupCode: 'PCT\\aballesteros', error: 'unique violation on contacts_closer_examiner_uniq' },
      ],
      rejected: [{ lookupCode: 'PCT\\jgomez', reasons: ['shifted'] }],
    });

    await expect(handleSyncContactType(OFFICER, { __jobId: 12 }, { now })).rejects.toThrow('1 attempts, 0 successes');
  });
});

describe('Sales Rep stays a single pass', () => {
  it('reads the whole roster in one request and keeps the deactivate guard', async () => {
    selectLimitMock.mockResolvedValueOnce([]);
    fetchSyncContactRowsMock.mockResolvedValueOnce({ items: [{ LookupCode: 'REP-1' }, { LookupCode: 'REP-2' }], error: null });

    const result = await handleSyncContactType('softpro.sync_contacts.sales_rep', {}, { now });

    expect(fetchSyncContactPageMock).not.toHaveBeenCalled();
    expect(syncContactRowsMock).toHaveBeenCalledWith('Sales Rep', expect.any(Array), { deactivateExistingSalesReps: true });
    expect(result.status).toBe('completed');
    expect(result.nextAllowedAt).not.toBeNull();
  });
});

describe('page budget sizing', () => {
  it('fits the slowest page started at the deadline inside the function ceiling', () => {
    const budget = budgetMsFor('softpro.sync_contacts_page');
    expect(budget + UNIT_P99_MS['softpro.sync_contacts_page']).toBeLessThanOrEqual(FUNCTION_CEILING_MS);
  });

  it('allows a page for the full client timeout (120s), not the average', () => {
    expect(UNIT_P99_MS['softpro.sync_contacts_page']).toBeGreaterThanOrEqual(120_000);
  });

  it('pins that the approved six pages at 67s would have overrun the 300s ceiling', () => {
    expect(6 * 67_000).toBeGreaterThan(FUNCTION_CEILING_MS);
  });
});
