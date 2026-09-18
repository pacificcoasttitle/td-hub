import { beforeEach, describe, expect, it, vi } from 'vitest';

// The claim is the only thing between a double-click and a second SiteX credit.
// These tests drive the real generate path with a fake database whose claim
// statement behaves the way production's does — proven separately against the
// live table: the second insert inside the window returns no row, and one after
// the window takes the claim over.

const { state, vendor, uploads } = vi.hoisted(() => ({
  state: {
    claims: new Map<string, { profileId: number | null; claimedAt: number }>(),
    now: () => Date.now(),
    windowMs: 15 * 60 * 1000,
    nextProfileId: 100,
    inserted: [] as Array<Record<string, unknown>>,
    updates: [] as Array<Record<string, unknown>>,
  },
  vendor: { calls: 0 },
  uploads: { calls: 0 },
}));

/** Stands in for the atomic INSERT … ON CONFLICT … WHERE claimed_at < cutoff. */
function runClaim(key: string): boolean {
  const held = state.claims.get(key);
  if (held && state.now() - held.claimedAt < state.windowMs) return false;
  state.claims.set(key, { profileId: null, claimedAt: state.now() });
  return true;
}

vi.mock('@/lib/db/client', () => ({
  db: {
    // Compiles the query the way the driver does, so the fake reads the real
    // SQL text and the real parameters rather than pattern-matching an object.
    execute: vi.fn(async (q: never) => {
      const { PgDialect } = await import('drizzle-orm/pg-core');
      const { sql: text, params } = new PgDialect().sqlToQuery(q);
      const key = String(params.find((p) => typeof p === 'string' && p.includes('|')) ?? '');
      if (text.includes('insert into concierge_profile_claims')) {
        return runClaim(key) ? [{ request_key: key }] : [];
      }
      if (text.includes('select profile_id')) {
        const c = state.claims.get(key);
        return [{ profile_id: c?.profileId ?? null, claimed_at: '2026-09-17 20:00:00' }];
      }
      if (text.includes('update concierge_profile_claims')) {
        const c = state.claims.get(key);
        const id = params.find((p) => typeof p === 'number');
        if (c && typeof id === 'number') c.profileId = id;
        return [];
      }
      if (text.includes('delete from concierge_profile_claims')) {
        state.claims.delete(key);
        return [];
      }
      return [];
    }),
    insert: vi.fn(() => ({
      values: (v: Record<string, unknown>) => ({
        returning: async () => { state.inserted.push(v); return [{ id: state.nextProfileId++ }]; },
      }),
    })),
    update: vi.fn(() => ({ set: (v: Record<string, unknown>) => ({ where: async () => { state.updates.push(v); } }) })),
  },
}));

const { owned } = vi.hoisted(() => ({ owned: { value: null as ExistingProfile | null } }));

vi.mock('@/lib/db/schema', () => ({ conciergeProfiles: { id: 'id' }, conciergeProfileComps: {}, conciergeProfileTransfers: {} }));
vi.mock('drizzle-orm', async () => {
  const actual = await vi.importActual<typeof import('drizzle-orm')>('drizzle-orm');
  return { ...actual, eq: (a: unknown, b: unknown) => ({ a, b }) };
});

vi.mock('@/lib/integrations/sitex/concierge-feed', () => ({
  getConciergeFeedId: () => '100001',
  guardMessage: (r: string) => `guard: ${r}`,
  fetchConciergeProfile: vi.fn(async () => {
    vendor.calls++;
    return {
      ok: true,
      payload: { Feed: {} },
      raw: '{}',
      guard: { isValidAddress: true, outsideCoverage: false, locationCount: 1, matchMethodCode: 'A', searchId: 900 },
      durationMs: 10,
      creditsCharged: 1,
    };
  }),
}));
vi.mock('@/lib/integrations/s3/client', () => ({
  uploadFile: vi.fn(async () => { uploads.calls++; return { success: true }; }),
}));
vi.mock('./normalize', () => ({
  normalizeSubject: () => ({ apn: '8378-014-021', fips: null, county: null, useCode: null, useDescription: null, beds: null, baths: null, buildingArea: null, lotSize: null, yearBuilt: null, latitude: null, longitude: null, lastSaleDate: null, lastSalePrice: null }),
  normalizeTax: () => ({ year: null, assessedValue: null, landValue: null, improvementValue: null, marketValue: null, taxAmount: null, status: null }),
  normalizeComps: () => [],
  normalizeTransfers: () => [],
  normalizePlatMap: () => null,
}));
vi.mock('./platmap', () => ({ convertPlatMap: async () => null }));
vi.mock('./already-have', async () => {
  const actual = await vi.importActual<typeof import('./already-have')>('./already-have');
  return { ...actual, findProfileForProperty: vi.fn(async () => owned.value) };
});
vi.mock('./render', () => ({ renderProfile: async () => ({ ok: true, compsShown: 6 }) }));

import { claimProperty, propertyRequestKey, releaseClaim } from './claim';
import type { ExistingProfile } from './already-have';
import { generateConciergeProfile } from './generate';

const ADDRESS = { street: '1358 5th St', city: 'La Verne', state: 'CA', zip: '91750' };
const input = () => ({
  ...ADDRESS,
  preparedForName: 'Dana Reyes',
  presentingRep: { name: 'Justin Nouri' },
  createdBy: 'ops@pct.com',
});

beforeEach(() => {
  state.claims.clear();
  state.inserted.length = 0;
  state.updates.length = 0;
  state.nextProfileId = 100;
  vendor.calls = 0;
  uploads.calls = 0;
  owned.value = null;
});

// ─── The other half of the guard ────────────────────────────────────────────
//
// The claim expires after fifteen minutes, by design. Without this check, the
// same property bought at 3:00pm buys again at 3:16pm at full price, silently.

describe('a property we already hold', () => {
  const HELD: ExistingProfile = {
    id: 3, createdAt: '2026-09-12T10:00:00Z', ageDays: 6,
    preparedForName: 'Internal test', presentingRepName: 'Mark Neveu', hasPdf: true,
  };

  it('does not reach the vendor at all', async () => {
    owned.value = HELD;
    const result = await generateConciergeProfile(input());
    expect(vendor.calls).toBe(0);
    expect(result.ok).toBe(false);
    expect((result as { creditsCharged: number }).creditsCharged).toBe(0);
  });

  it('returns the profile we already have, so the caller can offer it', async () => {
    owned.value = HELD;
    const result = await generateConciergeProfile(input()) as { alreadyHave?: ExistingProfile; message: string };
    expect(result.alreadyHave?.id).toBe(3);
    expect(result.message).toContain('12 September');
  });

  it('does not take the claim, so the property is not locked for fifteen minutes', async () => {
    // Refusing AND claiming would block the deliberate re-run that follows.
    owned.value = HELD;
    await generateConciergeProfile(input());
    expect(state.claims.size).toBe(0);
  });

  it('writes no row — a refusal is not an attempt', async () => {
    owned.value = HELD;
    await generateConciergeProfile(input());
    expect(state.inserted.length).toBe(0);
  });

  it('spends when the operator asked for a fresh one, having been shown it', async () => {
    owned.value = HELD;
    const result = await generateConciergeProfile({ ...input(), allowDuplicate: true });
    expect(result.ok).toBe(true);
    expect(vendor.calls).toBe(1);
  });

  it('stamps the property key on the row, or the next lookup finds nothing', async () => {
    owned.value = null;
    await generateConciergeProfile(input());
    expect(state.inserted[0]).toMatchObject({ propertyKey: propertyRequestKey(ADDRESS) });
  });
});

describe('the key a claim is taken on', () => {
  it('is the same for the same property typed differently', () => {
    expect(propertyRequestKey({ street: '1358 5th St.', city: 'La Verne', state: 'CA', zip: '91750' }))
      .toBe(propertyRequestKey({ street: '1358  5TH ST', city: 'la verne', state: 'ca', zip: '91750-1234' }));
  });

  it('is different for a different property', () => {
    expect(propertyRequestKey(ADDRESS)).not.toBe(propertyRequestKey({ ...ADDRESS, street: '1360 5th St' }));
  });

  it('does not collide across the field boundaries', () => {
    expect(propertyRequestKey({ street: '1 A', city: 'B', state: 'CA', zip: '91750' }))
      .not.toBe(propertyRequestKey({ street: '1', city: 'A B', state: 'CA', zip: '91750' }));
  });
});

describe('two requests for the same property, seconds apart', () => {
  it('spend ONE credit, not two', async () => {
    const first = await generateConciergeProfile(input());
    const second = await generateConciergeProfile(input());

    expect(vendor.calls).toBe(1);
    expect(first).toMatchObject({ ok: true, creditsCharged: 1 });
    expect(second).toMatchObject({ ok: false, duplicate: true, creditsCharged: 0 });
  });

  it('returns the first profile rather than a bare refusal', async () => {
    const first = await generateConciergeProfile(input());
    const second = await generateConciergeProfile(input()) as { profileId: number | null; message: string };

    expect(second.profileId).toBe((first as { profileId: number }).profileId);
    expect(second.message).toContain('nothing was charged');
  });

  it('holds even when the address is typed differently the second time', async () => {
    await generateConciergeProfile(input());
    const second = await generateConciergeProfile({ ...input(), street: '1358  5TH ST.', city: 'LA VERNE', zip: '91750-1234' });

    expect(vendor.calls).toBe(1);
    expect(second).toMatchObject({ duplicate: true });
  });

  it('does not block a different property', async () => {
    await generateConciergeProfile(input());
    const other = await generateConciergeProfile({ ...input(), street: '1360 5th St' });

    expect(vendor.calls).toBe(2);
    expect(other).toMatchObject({ ok: true });
  });

  it('is not keyed on the order — two orders for one property still spend once', async () => {
    await generateConciergeProfile({ ...input(), orderId: 111 });
    const second = await generateConciergeProfile({ ...input(), orderId: 222 });

    expect(vendor.calls).toBe(1);
    expect(second).toMatchObject({ duplicate: true });
  });

  it('lets a genuine re-run through once the window has passed', async () => {
    await generateConciergeProfile(input());
    const held = state.claims.get(propertyRequestKey(ADDRESS))!;
    held.claimedAt -= state.windowMs + 1000;

    const later = await generateConciergeProfile(input());

    expect(vendor.calls).toBe(2);
    expect(later).toMatchObject({ ok: true });
  });
});

describe('a claim is given back only when nothing was spent', () => {
  it('releases after a failure that charged no credit, so a retry is not locked out', async () => {
    const feed = await import('@/lib/integrations/sitex/concierge-feed');
    vi.mocked(feed.fetchConciergeProfile).mockResolvedValueOnce({
      ok: false, reason: 'network', message: 'fetch failed', guard: null, durationMs: 5, creditsCharged: 0,
    } as never);

    const failed = await generateConciergeProfile(input());
    expect(failed).toMatchObject({ ok: false, creditsCharged: 0 });
    expect(state.claims.has(propertyRequestKey(ADDRESS))).toBe(false);

    const retry = await generateConciergeProfile(input());
    expect(retry).toMatchObject({ ok: true });
  });

  it('keeps the claim when the refused call still charged, so the next click cannot spend again', async () => {
    const feed = await import('@/lib/integrations/sitex/concierge-feed');
    vi.mocked(feed.fetchConciergeProfile).mockResolvedValueOnce({
      ok: false, reason: 'multiple_locations', message: 'more than one match',
      guard: { isValidAddress: true, outsideCoverage: false, locationCount: 3, matchMethodCode: 'M', searchId: 901 },
      durationMs: 9, creditsCharged: 1,
    } as never);

    const refused = await generateConciergeProfile(input());
    expect(refused).toMatchObject({ ok: false, creditsCharged: 1 });

    const second = await generateConciergeProfile(input());
    expect(second).toMatchObject({ duplicate: true });
    expect(vendor.calls).toBe(0);
  });
});

describe('claimProperty on its own', () => {
  it('reports who holds the claim when it loses', async () => {
    const key = propertyRequestKey(ADDRESS);
    expect(await claimProperty(key)).toEqual({ held: true });
    const lost = await claimProperty(key);
    expect(lost.held).toBe(false);
    await releaseClaim(key);
    expect(await claimProperty(key)).toEqual({ held: true });
  });
});
