import { describe, expect, it, vi } from 'vitest';

const { rows } = vi.hoisted(() => ({ rows: { value: [] as unknown[] } }));

vi.mock('@/lib/db/client', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: () => Promise.resolve(rows.value) }) }) }) }),
  },
}));

const { alreadyHaveMessage, findProfileForProperty } = await import('./already-have');
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
