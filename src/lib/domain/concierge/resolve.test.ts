import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Resolve first, then finalise ───────────────────────────────────────────
//
// The flow these tests describe (Gerard, 16 Oct 2026): the address step does
// the lookup and spends the one credit; everything the operator fills in
// afterwards is free.
//
// What it replaced is worth stating, because it is what the tests are measuring
// against. The gate came first: six fields, then Generate, and only then
// "SiteX returned HTTP 300" — four parcels at that address, a credit already
// gone. Picking one re-sent the whole form and charged again. A condominium
// cost two credits; 25651 Paseo La Cresta cost several, over three weeks,
// without ever producing a document.

const { state, vendor } = vi.hoisted(() => ({
  state: {
    rows: new Map<number, Record<string, unknown>>(),
    nextId: 100,
    claims: new Set<string>(),
    stored: new Map<string, string>(),
    resolution: null as { id: number; createdAt: string; ageMinutes: number; rawStorageKey: string } | null,
    owned: null as unknown,
    ingested: [] as number[],
    rendered: [] as number[],
  },
  vendor: { calls: 0, charge: 1, ok: true as boolean, searchId: 900 },
}));

/**
 * The payload SiteX returns for the Paseo La Cresta unit, cut to the fields
 * these tests read. The owner name is the thing an operator recognises a
 * condominium unit by, so it travels all the way to the gate.
 */
const PAYLOAD = JSON.stringify({
  OrderInfo: { SearchId: 900 },
  Feed: { PropertyProfile: { APN: '930-371-05', PrimaryOwnerName: 'LIPSITZ' } },
});

vi.mock('@/lib/db/client', () => ({
  db: {
    execute: vi.fn(async (q: never) => {
      const { PgDialect } = await import('drizzle-orm/pg-core');
      const { sql: text, params } = new PgDialect().sqlToQuery(q);
      const key = String(params.find((p) => typeof p === 'string' && p.includes('|')) ?? '');
      if (text.includes('insert into concierge_profile_claims')) {
        if (state.claims.has(key)) return [];
        state.claims.add(key);
        return [{ request_key: key }];
      }
      if (text.includes('delete from concierge_profile_claims')) { state.claims.delete(key); return []; }
      return [];
    }),
    insert: vi.fn(() => ({
      values: (v: Record<string, unknown>) => ({
        returning: async () => {
          const id = state.nextId++;
          state.rows.set(id, { id, ...v });
          return [{ id }];
        },
      }),
    })),
    update: vi.fn(() => ({
      set: (v: Record<string, unknown>) => ({
        where: async (w: { b?: number }) => {
          // The fake `eq` below hands back {a, b}; b is the id.
          const id = typeof w?.b === 'number' ? w.b : state.nextId - 1;
          state.rows.set(id, { ...(state.rows.get(id) ?? { id }), ...v });
        },
      }),
    })),
    // WHICH TABLE matters here, unlike in claim.test.ts. `resumeFromStored`
    // asks whether the profile already holds its comparables, and a fake that
    // answered with the profile row for every table reported "yes" — refusing
    // every finalise with has_comps, which looked exactly like a broken gate.
    select: vi.fn(() => ({
      from: (t: { _t?: string }) => ({
        where: (w: { b?: number }) => ({
          limit: async () => {
            if (t?._t !== 'profiles') return [];
            const id = typeof w?.b === 'number' ? w.b : state.nextId - 1;
            const row = state.rows.get(id);
            return row ? [row] : [];
          },
          orderBy: () => ({ limit: async () => [] }),
        }),
      }),
    })),
  },
}));

vi.mock('@/lib/db/schema', () => ({
  conciergeProfiles: { id: 'id', _t: 'profiles' },
  conciergeProfileComps: { id: 'id', _t: 'comps' },
  conciergeProfileTransfers: { _t: 'transfers' },
}));
vi.mock('drizzle-orm', async () => {
  const actual = await vi.importActual<typeof import('drizzle-orm')>('drizzle-orm');
  return { ...actual, eq: (a: unknown, b: unknown) => ({ a, b }) };
});

vi.mock('@/lib/integrations/sitex/concierge-feed', () => ({
  getConciergeFeedId: () => '100001',
  guardMessage: (r: string) => `guard: ${r}`,
  fetchConciergeProfile: vi.fn(async () => {
    vendor.calls++;
    if (!vendor.ok) {
      return {
        ok: false, reason: 'ambiguous_match', message: 'more than one',
        candidates: [{ apn: '930-371-05', fips: '06059' }],
        guard: { locationCount: 2 }, durationMs: 10, creditsCharged: vendor.charge, raw: undefined,
      };
    }
    return {
      ok: true,
      payload: JSON.parse(PAYLOAD),
      raw: PAYLOAD,
      guard: { isValidAddress: true, outsideCoverage: false, locationCount: 1, matchMethodCode: 'A', searchId: vendor.searchId },
      durationMs: 10,
      creditsCharged: vendor.charge,
    };
  }),
}));

vi.mock('@/lib/integrations/s3/client', () => ({
  uploadFile: vi.fn(async ({ key, buffer }: { key: string; buffer: Buffer }) => {
    state.stored.set(key, buffer.toString('utf8'));
    return { success: true };
  }),
  downloadFile: vi.fn(async (key: string) => {
    const data = state.stored.get(key);
    return data === undefined
      ? { success: false, data: null }
      : { success: true, data: Buffer.from(data, 'utf8') };
  }),
}));

vi.mock('./already-have', async () => {
  const actual = await vi.importActual<typeof import('./already-have')>('./already-have');
  return {
    ...actual,
    findProfileForProperty: vi.fn(async () => state.owned),
    findResolvedForProperty: vi.fn(async () => state.resolution),
  };
});

vi.mock('./ingest', () => ({
  ingestPayload: vi.fn(async (id: number) => {
    state.ingested.push(id);
    return { apn: '930-371-05', compsReturned: 25 };
  }),
}));
vi.mock('./render', () => ({
  renderProfile: vi.fn(async (id: number) => { state.rendered.push(id); return { ok: true, compsShown: 6 }; }),
}));
vi.mock('./normalize', () => ({
  normalizeSubject: (feed: { PropertyProfile?: Record<string, unknown> }) => ({
    apn: (feed.PropertyProfile?.APN as string) ?? null,
    primaryOwner: (feed.PropertyProfile?.PrimaryOwnerName as string) ?? null,
    fips: null, county: null, useCode: null, useDescription: null,
    siteAddress: null, siteCityState: null,
  }),
  normalizeTax: () => ({}), normalizeComps: () => [], normalizeTransfers: () => [], normalizePlatMap: () => null,
}));
vi.mock('./platmap', () => ({ convertPlatMap: async () => null }));

const { resolveProperty, finaliseProfile } = await import('./generate');

const ADDRESS = { street: '25651 Paseo La Cresta', city: 'Laguna Niguel', state: 'CA', zip: '92677' };
const GATE = {
  preparedForName: 'Dana Reyes',
  presentingRep: { name: 'Justin Nouri' },
};

beforeEach(() => {
  state.rows.clear();
  state.claims.clear();
  state.stored.clear();
  state.nextId = 100;
  state.resolution = null;
  state.owned = null;
  state.ingested.length = 0;
  state.rendered.length = 0;
  vendor.calls = 0;
  vendor.charge = 1;
  vendor.ok = true;
  vendor.searchId = 900;
});

describe('resolve spends the credit and produces no document', () => {
  it('answers which property it is, with the owner the operator recognises', async () => {
    const r = await resolveProperty(ADDRESS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.resolved).toMatchObject({
      apn: '930-371-05', primaryOwner: 'LIPSITZ',
      creditsCharged: 1, reused: false, searchId: 900,
    });
  });

  it('writes NO prepared-for name, because nobody has typed one yet', async () => {
    // The whole design in one assertion. If these columns are filled in at
    // resolve, the gate is back in front of the lookup and the flow has
    // quietly reverted.
    const r = await resolveProperty(ADDRESS);
    const row = state.rows.get((r as { resolved: { profileId: number } }).resolved.profileId)!;
    expect(row.preparedForName).toBeUndefined();
    expect(row.presentingRepName).toBeUndefined();
  });

  it('renders nothing and ingests nothing', async () => {
    await resolveProperty(ADDRESS);
    expect(state.rendered).toEqual([]);
    expect(state.ingested).toEqual([]);
  });

  it('leaves the row holding the payload, ready to be finished', async () => {
    const r = await resolveProperty(ADDRESS) as { resolved: { profileId: number } };
    const row = state.rows.get(r.resolved.profileId)!;
    expect(row.status).toBe('retrieved');
    expect(row.rawStorageKey).toBe(`concierge/${r.resolved.profileId}/sitex-raw.json`);
    expect(row.sitexSearchId).toBe(900);
    expect(row.sitexCreditsCharged).toBe(1);
    // Identity, so the Reports list and the gate can name the property. Not
    // the valuations or the comparables — those are derived work and belong to
    // finalise, which can redo them for nothing.
    expect(row.subjectApn).toBe('930-371-05');
    expect(row.compsReturned).toBeUndefined();
  });
});

describe('two operators, one credit', () => {
  it('reuses a resolution already paid for, charging nothing', async () => {
    // The first operator resolves.
    const first = await resolveProperty(ADDRESS) as { resolved: { profileId: number } };
    expect(vendor.calls).toBe(1);

    // The second operator, minutes later, with the claim already released.
    state.resolution = {
      id: first.resolved.profileId, createdAt: new Date().toISOString(), ageMinutes: 5,
      rawStorageKey: `concierge/${first.resolved.profileId}/sitex-raw.json`,
    };
    const second = await resolveProperty(ADDRESS);

    expect(vendor.calls, 'the vendor must not be asked twice').toBe(1);
    expect(second).toMatchObject({
      ok: true,
      resolved: { profileId: first.resolved.profileId, creditsCharged: 0, reused: true },
    });
  });

  it('hands the second operator the same property, not an empty shell', async () => {
    // Reuse is only worth anything if the gate can still show what was bought.
    const first = await resolveProperty(ADDRESS) as { resolved: { profileId: number } };
    state.resolution = {
      id: first.resolved.profileId, createdAt: new Date().toISOString(), ageMinutes: 5,
      rawStorageKey: `concierge/${first.resolved.profileId}/sitex-raw.json`,
    };
    const second = await resolveProperty(ADDRESS);
    expect(second.ok && second.resolved).toMatchObject({ apn: '930-371-05', primaryOwner: 'LIPSITZ' });
  });

  it('buys it again when the stored payload cannot be read', async () => {
    // A stored object we cannot parse must not be able to block a property
    // from ever being looked up again. Falling through costs a credit; the
    // alternative is an address nobody can ever generate.
    state.resolution = {
      id: 77, createdAt: new Date().toISOString(), ageMinutes: 1,
      rawStorageKey: 'concierge/77/does-not-exist.json',
    };
    const r = await resolveProperty(ADDRESS);
    expect(vendor.calls).toBe(1);
    expect(r).toMatchObject({ ok: true, resolved: { reused: false, creditsCharged: 1 } });
  });

  it('does not reuse when the operator asked for a fresh lookup', async () => {
    // Someone who has been shown what we hold and asked for a fresh call is
    // asking for fresh data. Handing them this morning's payload would be a
    // silent refusal.
    state.resolution = {
      id: 55, createdAt: new Date().toISOString(), ageMinutes: 5,
      rawStorageKey: 'concierge/55/sitex-raw.json',
    };
    state.stored.set('concierge/55/sitex-raw.json', PAYLOAD);
    const r = await resolveProperty({ ...ADDRESS, allowDuplicate: true });
    expect(vendor.calls).toBe(1);
    expect(r).toMatchObject({ ok: true, resolved: { reused: false } });
  });
});

describe('a multi-match costs nothing and comes back as a choice', () => {
  it('charges nothing and returns the parcels to choose between', async () => {
    vendor.ok = false;
    vendor.charge = 0;
    const r = await resolveProperty(ADDRESS);
    expect(r).toMatchObject({ ok: false, creditsCharged: 0 });
    expect((r as { candidates?: unknown[] }).candidates).toHaveLength(1);
  });

  it('so a condominium costs ONE credit in total, not two', async () => {
    // The Paseo La Cresta bill. The 300 was free; the pick is the spend. Under
    // the old flow the address search charged, the pick charged again, and the
    // guard then threw the second payload away.
    vendor.ok = false;
    vendor.charge = 0;
    const ambiguous = await resolveProperty(ADDRESS);
    expect(ambiguous.ok).toBe(false);

    vendor.ok = true;
    vendor.charge = 1;
    const picked = await resolveProperty({ ...ADDRESS, apn: '930-371-05', fips: '06059' });

    expect(picked).toMatchObject({ ok: true, resolved: { creditsCharged: 1 } });
  });
});

describe('finalise renders what was paid for, and cannot buy more', () => {
  const resolved = async () => {
    const r = await resolveProperty(ADDRESS) as { resolved: { profileId: number } };
    return r.resolved.profileId;
  };

  it('writes the gate onto the row and renders', async () => {
    const id = await resolved();
    const done = await finaliseProfile(id, GATE);
    expect(done).toMatchObject({ ok: true, profileId: id });
    const row = state.rows.get(id)!;
    expect(row.preparedForName).toBe('Dana Reyes');
    expect(row.presentingRepName).toBe('Justin Nouri');
    expect(state.ingested).toEqual([id]);
    expect(state.rendered).toEqual([id]);
  });

  it('spends nothing — the vendor is not asked again', async () => {
    const id = await resolved();
    vendor.calls = 0;
    await finaliseProfile(id, GATE);
    expect(vendor.calls).toBe(0);
  });

  it('REFUSES a profile with no stored payload rather than fetching one', async () => {
    // The line between finishing and buying it again.
    state.rows.set(500, { id: 500, status: 'failed', rawStorageKey: null });
    const r = await finaliseProfile(500, GATE);
    expect(r.ok).toBe(false);
    expect(vendor.calls).toBe(0);
    expect((r as { message: string }).message).toMatch(/without buying it again/);
  });

  it('says "already generated" rather than failing, for the second operator', async () => {
    const id = await resolved();
    state.rows.set(id, { ...state.rows.get(id)!, pdfStorageKey: `concierge/${id}/profile.pdf` });
    const r = await finaliseProfile(id, GATE);
    expect(r).toMatchObject({ ok: false, alreadyGenerated: true });
    expect((r as { message: string }).message).toContain('nothing was charged');
  });

  it('carries the operator\'s criteria into the render', async () => {
    const id = await resolved();
    const { renderProfile } = await import('./render');
    await finaliseProfile(id, { ...GATE, criteria: { sameUseCode: false, livingAreaPct: 10, bedDelta: 1, bathDelta: 1, radiusMiles: 2, months: 6, maxComps: 8 } });
    expect(renderProfile).toHaveBeenCalledWith(id, expect.objectContaining({ maxComps: 8 }));
    expect(state.rows.get(id)!.criteriaMaxComps).toBe(8);
  });
});

describe('resolve and finalise together, for the orders flow', () => {
  it('still works as one call, and charges once', async () => {
    const { generateConciergeProfile } = await import('./generate');
    const r = await generateConciergeProfile({ ...ADDRESS, ...GATE });
    expect(r).toMatchObject({ ok: true, creditsCharged: 1, compsShown: expect.any(Number) });
    expect(vendor.calls).toBe(1);
    expect(state.rendered).toHaveLength(1);
  });
});
