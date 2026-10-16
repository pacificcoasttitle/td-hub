import { describe, expect, it, vi } from 'vitest';

const { rows } = vi.hoisted(() => ({ rows: { value: [] as unknown[] } }));

vi.mock('@/lib/db/client', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: () => Promise.resolve(rows.value) }) }) }) }),
  },
}));

const {
  alreadyHaveMessage, findProfileForProperty, findResolvedForProperty, RESOLUTION_TTL_MS,
} = await import('./already-have');
const { propertyRequestKey } = await import('./claim');

const NOW = new Date('2026-09-18T12:00:00Z');
const row = (over: Record<string, unknown> = {}) => ({
  id: 3, createdAt: new Date('2026-09-12T10:00:00Z'),
  preparedForName: 'Internal test', presentingRepName: 'Mark Neveu',
  pdfStorageKey: 'concierge/3/profile.pdf', ...over,
});

describe('do we already have this property', () => {
  it('finds the profile and says how old it is', async () => {
    rows.value = [row()];
    const found = await findProfileForProperty('1358 5th st|la verne|ca|91750', NOW);
    expect(found).toMatchObject({ id: 3, ageDays: 6, preparedForName: 'Internal test' });
  });

  it('answers no when nothing matches', async () => {
    rows.value = [];
    expect(await findProfileForProperty('nowhere|nowhere|ca|00000', NOW)).toBeNull();
  });

  it('is asked with the SAME key the claim takes', async () => {
    // Two people typing one property must not buy two reports, which is the
    // entire point of the key — so this must not be a second normalization.
    rows.value = [row()];
    const typedOneWay = propertyRequestKey({ street: '1358 5th St', city: 'La Verne', state: 'CA', zip: '91750' });
    const typedAnother = propertyRequestKey({ street: '1358  5TH ST.', city: 'la verne', state: 'ca', zip: '91750-5301' });
    expect(typedOneWay).toBe(typedAnother);
  });

  it('never claims we have one when the key is empty', async () => {
    // A profile row predating migration 0059 has a NULL key. Matching on empty
    // would tell an operator we hold a property we have never bought.
    rows.value = [row()];
    expect(await findProfileForProperty('', NOW)).toBeNull();
  });
});

// ─── A resolution: paid for, not yet a document ─────────────────────────────
//
// The gap the resolve-first flow opens. Between the credit being spent and the
// operator filling in the gate, the claim has already been released — it is
// released the moment the lookup succeeds — so there is a window in which the
// same property can be bought a second time by anyone. This is what closes it.

describe('a resolution already paid for', () => {
  const KEY = '1358 5th st|la verne|ca|91750';
  const resolvedRow = (over: Record<string, unknown> = {}) => ({
    id: 11, createdAt: new Date(NOW.getTime() - 10 * 60_000),
    rawStorageKey: 'concierge/11/sitex-raw.json', ...over,
  });

  it('is found within the window, with how long ago it was bought', async () => {
    rows.value = [resolvedRow()];
    const found = await findResolvedForProperty(KEY, NOW);
    expect(found).toMatchObject({ id: 11, ageMinutes: 10, rawStorageKey: 'concierge/11/sitex-raw.json' });
  });

  it('EXPIRES, because the payload is a snapshot and the document is dated', async () => {
    // A month-old payload finalised today prints month-old assessed values
    // under today's date, which is worse than paying again.
    rows.value = [resolvedRow({ createdAt: new Date(NOW.getTime() - RESOLUTION_TTL_MS - 1000) })];
    expect(await findResolvedForProperty(KEY, NOW)).toBeNull();
  });

  it('survives an interruption long enough to be useful', async () => {
    // The point of a day rather than the claim's fifteen minutes: an operator
    // resolves an address, gets pulled onto a closing, and comes back after
    // lunch. Fifteen minutes would charge them twice for that.
    rows.value = [resolvedRow({ createdAt: new Date(NOW.getTime() - 3 * 60 * 60_000) })];
    expect(await findResolvedForProperty(KEY, NOW)).not.toBeNull();
  });

  it('is NOT offered when the payload never reached storage', async () => {
    // A 'retrieved' row whose upload failed has nothing to finalise FROM.
    // Offering it would strand the second operator on a row that can never
    // produce a document — and they would have no way to buy the property.
    rows.value = [resolvedRow({ rawStorageKey: null })];
    expect(await findResolvedForProperty(KEY, NOW)).toBeNull();
  });

  it('never matches on an empty key', async () => {
    rows.value = [resolvedRow()];
    expect(await findResolvedForProperty('', NOW)).toBeNull();
  });

  it('ignores a row from the future rather than treating it as fresh', async () => {
    // Clock skew between the app and the database. A negative age read as
    // "within the window" would reuse a row whose payload may not be written.
    rows.value = [resolvedRow({ createdAt: new Date(NOW.getTime() + 60_000) })];
    expect(await findResolvedForProperty(KEY, NOW)).toBeNull();
  });
});

describe('what the operator is told', () => {
  const msg = (over: Record<string, unknown> = {}) => alreadyHaveMessage({
    id: 3, createdAt: '2026-09-12T10:00:00Z', ageDays: 6,
    preparedForName: null, presentingRepName: null, hasPdf: true, ...over,
  });

  it('names the date and the age, because that is the judgement being asked', () => {
    expect(msg()).toContain('12 September');
    expect(msg()).toContain('6 days ago');
  });

  it('offers both options and says what a fresh one really means', () => {
    // No longer priced (Gerard, 2026-09-23). "A second property lookup" is
    // the consequence an operator can actually act on; the number of credits
    // was never theirs to weigh.
    expect(msg()).toContain('Open it');
    expect(msg()).toContain('second property lookup');
    expect(msg()).not.toMatch(/credit/i);
  });

  it('reads naturally for today and yesterday', () => {
    expect(msg({ ageDays: 0 })).toContain('(today)');
    expect(msg({ ageDays: 1 })).toContain('(yesterday)');
  });
});
