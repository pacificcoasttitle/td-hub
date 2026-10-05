import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readSource } from '@/test-support/read-source';

// ─── The safety net ─────────────────────────────────────────────────────────
//
// It exists because profile 9's finishing work was a promise fired after the
// response, and a serverless function froze before the render ran. These assert
// the two things that make a sweeper a safety net rather than another way to
// lose work: it finds outstanding profiles from the TABLE, and it can never buy
// a second search.

const rows = vi.hoisted(() => ({ value: [] as Array<Record<string, unknown>> }));
const finishes = vi.hoisted(() => ({ calls: [] as Array<[number, number, string | null]>, impl: null as null | ((id: number) => unknown) }));

vi.mock('@/lib/db/client', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ limit: () => Promise.resolve(rows.value) }),
        }),
      }),
    }),
  },
}));

vi.mock('@/lib/db/schema', () => ({
  conciergeProfiles: {
    id: 'id', titlePointDataId: 'tpid', titlePointRequestId: 'tprid',
    titlePointRequestedAt: 'tpat', taxDetailStatus: 'status',
  },
}));

vi.mock('@/lib/domain/concierge/tax-bridge', () => ({
  finishTaxDetail: (profileId: number, dataId: number, requestId: string | null) => {
    finishes.calls.push([profileId, dataId, requestId]);
    if (finishes.impl) return Promise.resolve(finishes.impl(profileId));
    return Promise.resolve({ ok: true, profileId, status: 'ready', titlePointCharges: 0, requestId, message: 'done' });
  },
}));

const { handleConciergeTaxFinish } = await import('./concierge-tax-finish');

const old = new Date(Date.now() - 10 * 60_000);

beforeEach(() => {
  rows.value = [];
  finishes.calls = [];
  finishes.impl = null;
});

describe('it finishes what is outstanding', () => {
  it('finishes every profile it is given and reports each outcome', async () => {
    rows.value = [
      { id: 9, dataId: 5238, requestId: '807084748', requestedAt: old },
      { id: 11, dataId: 5301, requestId: '807084900', requestedAt: old },
    ];
    const r = await handleConciergeTaxFinish();
    expect(finishes.calls.map((c) => c[0])).toEqual([9, 11]);
    // The data id and request id go through — finishing polls a specific search.
    expect(finishes.calls[0]).toEqual([9, 5238, '807084748']);
    expect(r.finished).toBe(2);
    expect(r.outcomes).toHaveLength(2);
  });

  it('counts a still-running search as waiting, not as failed', async () => {
    // It is paid for and will be swept again. Calling that a failure would put
    // a red mark on a search that is simply not done.
    rows.value = [{ id: 9, dataId: 5238, requestId: 'x', requestedAt: old }];
    finishes.impl = () => ({ ok: false, status: 'pending', message: 'still running' });
    const r = await handleConciergeTaxFinish();
    expect(r.stillWaiting).toBe(1);
    expect(r.failed).toBe(0);
  });

  it('counts an empty county as finished, because nothing more will happen', async () => {
    rows.value = [{ id: 9, dataId: 5238, requestId: 'x', requestedAt: old }];
    finishes.impl = () => ({ ok: true, status: 'empty', message: 'no record' });
    const r = await handleConciergeTaxFinish();
    expect(r.finished).toBe(1);
    expect(r.stillWaiting).toBe(0);
  });

  it('one profile throwing does not strand the rest of the batch', async () => {
    rows.value = [
      { id: 9, dataId: 1, requestId: null, requestedAt: old },
      { id: 11, dataId: 2, requestId: null, requestedAt: old },
      { id: 12, dataId: 3, requestId: null, requestedAt: old },
    ];
    finishes.impl = (id) => { if (id === 11) throw new Error('S3 unreachable'); return { ok: true, status: 'ready', message: 'done' }; };
    const r = await handleConciergeTaxFinish();
    expect(finishes.calls.map((c) => c[0])).toEqual([9, 11, 12]);
    expect(r.finished).toBe(2);
    expect(r.failed).toBe(1);
    expect(r.outcomes.find((o) => o.profileId === 11)!.message).toContain('S3 unreachable');
  });

  it('leaves a search alone until the request that started it has gone', async () => {
    // Otherwise the sweeper races the operator's own foreground finish and they
    // both poll and both render the same profile.
    rows.value = [{ id: 9, dataId: 5238, requestId: 'x', requestedAt: new Date() }];
    const r = await handleConciergeTaxFinish();
    expect(finishes.calls).toHaveLength(0);
    expect(r.considered).toBe(0);
  });

  it('skips a row with no titlepoint_data_id, which has nothing to finish', async () => {
    rows.value = [{ id: 9, dataId: null, requestId: null, requestedAt: old }];
    const r = await handleConciergeTaxFinish();
    expect(finishes.calls).toHaveLength(0);
    expect(r.finished).toBe(0);
  });
});

describe('it cannot spend', () => {
  // readSource, not readFileSync: it strips comments — this file's docblocks
  // discuss every name below — and it fails loudly if the anchor is gone rather
  // than quietly asserting about a file it no longer understands.
  const src = () => readSource(join(__dirname, 'concierge-tax-finish.ts'), {
    mustContain: 'export async function handleConciergeTaxFinish',
  });

  it('reaches TitlePoint only through finishTaxDetail', () => {
    // The sweeper runs unattended on a schedule. If it could reach the creating
    // path it would buy a search every five minutes for every profile it found.
    expect(src()).toContain('finishTaxDetail');
    expect(src()).not.toContain('requestTaxDetail');
    expect(src()).not.toContain('createServicePreOrderTax');
    expect(src()).not.toMatch(/integrations\/titlepoint|integrations\/sitex/);
  });

  it('only ever looks at statuses that are already paid for', () => {
    // 'pending' and 'fetched' are bought. A sweeper that picked up null or
    // 'denied' would be starting work nobody asked for.
    expect(src()).toContain("['pending', 'fetched']");
    expect(src()).not.toContain("'denied'");
  });
});
