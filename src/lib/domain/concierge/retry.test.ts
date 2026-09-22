import { beforeEach, describe, expect, it, vi } from 'vitest';

const s = vi.hoisted(() => ({
  profile: null as Record<string, unknown> | null,
  hasComps: false,
  calls: [] as string[],
}));

// Two selects happen in order: the profile, then "any comps?". The fake
// answers by the column set it is asked for.
vi.mock('@/lib/db/client', () => ({
  db: {
    select: (cols?: Record<string, unknown>) => ({
      from: () => ({
        where: () => ({
          limit: async () => (cols ? (s.hasComps ? [{ id: 1 }] : []) : (s.profile ? [s.profile] : [])),
        }),
      }),
    }),
  },
}));
vi.mock('@/lib/integrations/s3/client', () => ({
  downloadFile: vi.fn(async () => ({ success: true, data: Buffer.from('{"Feed":{}}') })),
}));
vi.mock('./generate', () => ({
  ingestPayload: vi.fn(async () => { s.calls.push('ingest'); return { apn: null, compsReturned: 25 }; }),
}));
vi.mock('./render', () => ({
  renderProfile: vi.fn(async () => { s.calls.push('render'); return { ok: true, compsShown: 4 }; }),
}));

const { retryProfile, resumeFromStored, NO_PAYLOAD_MESSAGE } = await import('./retry');

beforeEach(() => {
  s.profile = { id: 3, rawStorageKey: 'concierge/3/sitex-raw.json' };
  s.hasComps = false;
  s.calls.length = 0;
});

describe('Try again on a concierge profile', () => {
  it('finishes the ingest when it never ran', async () => {
    expect(await retryProfile(3)).toEqual({ ok: true, mode: 'resumed' });
    expect(s.calls).toEqual(['ingest', 'render']);
  });

  it('re-renders, without ingesting twice, when the comparables are already in', async () => {
    s.hasComps = true;
    expect(await retryProfile(3)).toEqual({ ok: true, mode: 'rerendered' });
    expect(s.calls).toEqual(['render']);
  });

  it('refuses a profile with no stored payload — that retry would buy it again', async () => {
    s.profile = { id: 3, rawStorageKey: null };
    expect(await retryProfile(3)).toMatchObject({ ok: false, reason: 'no_payload', message: NO_PAYLOAD_MESSAGE });
    expect(s.calls).toEqual([]);
  });

  it('keeps resume\'s own refusal when the comparables are in, for its route', async () => {
    s.hasComps = true;
    expect(await resumeFromStored(3)).toMatchObject({ ok: false, reason: 'has_comps' });
  });
});
