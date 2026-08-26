import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { deriveOwnerKind } from './owner-kind';

// Two real production payloads, kept from the approved billable calls. Where
// they are present the assertions run against genuine vendor output; where they
// are not, the synthetic cases below still cover every branch.
const ENTITY_PAYLOAD = 'C:/Users/gerar/Desktop/TransactionDeskV2/outputs/sitex-entity/entity-owner-100001-raw.json';

const deed = (buyer: Record<string, unknown>, flag: unknown = 'True') => ({
  Feed: { TransferHistory: [{ CurrentOwnerFlag: flag, Deed: { BuyerInfo: { Buyers: { Buyer: [buyer] } } } }] },
});

describe('the discriminator is the KEY, not the value', () => {
  it('entity: FirstAndMiddleName absent', () => {
    const r = deriveOwnerKind(deed({ LastOrCorporateName: '5558 RIVERTON LLC', EntityCode: 'LC', EntityCodeDesc: 'Limited Liability Company' }));
    expect(r.kind).toBe('entity');
    expect(r.reason).toBe('first-and-middle-name-absent');
    expect(r.lastOrCorporateName).toBe('5558 RIVERTON LLC');
    expect(r.entityCode).toBe('LC');
  });

  it('person: FirstAndMiddleName present', () => {
    const r = deriveOwnerKind(deed({ LastOrCorporateName: 'KAO', FirstAndMiddleName: 'DENNIS', EntityCode: 'HW' }));
    expect(r.kind).toBe('person');
    expect(r.reason).toBe('first-and-middle-name-present');
  });

  it('an EMPTY FirstAndMiddleName counts as absent, not as a person', () => {
    for (const v of ['', '   ', null]) {
      expect(deriveOwnerKind(deed({ LastOrCorporateName: 'X LLC', FirstAndMiddleName: v })).kind).toBe('entity');
    }
  });

  it('EntityCode is carried but never decides', () => {
    // AK appears on both an entity and a person in the same real payload, and
    // one party had no EntityCode at all. The key's presence is what rules.
    expect(deriveOwnerKind(deed({ LastOrCorporateName: 'AMBER INVESTMENT GROUP', EntityCode: 'AK' })).kind).toBe('entity');
    expect(deriveOwnerKind(deed({ LastOrCorporateName: 'VASQUEZ', FirstAndMiddleName: 'CARMEN L', EntityCode: 'AK' })).kind).toBe('person');
    expect(deriveOwnerKind(deed({ LastOrCorporateName: 'ALVARADO', FirstAndMiddleName: 'ROSA E' })).kind).toBe('person');
  });

  it('accepts CurrentOwnerFlag as the string SiteX actually sends', () => {
    expect(deriveOwnerKind(deed({ LastOrCorporateName: 'X LLC' }, 'True')).kind).toBe('entity');
    expect(deriveOwnerKind(deed({ LastOrCorporateName: 'X LLC' }, true)).kind).toBe('entity');
    expect(deriveOwnerKind(deed({ LastOrCorporateName: 'X LLC' }, 'true')).kind).toBe('entity');
  });

  it('reads a single Buyer object as well as an array', () => {
    const raw = { Feed: { TransferHistory: [{ CurrentOwnerFlag: 'True', Deed: { BuyerInfo: { Buyers: { Buyer: { LastOrCorporateName: 'X LLC' } } } } }] } };
    expect(deriveOwnerKind(raw).kind).toBe('entity');
  });
});

// ─── Prove it can return 'unknown' before trusting that it doesn't ──────────
//
// A deriver that answered 'person' for everything would look perfect against a
// person-owned payload and silently defeat the whole feature. Each absence is a
// distinct reason so 'unknown' is explainable rather than a shrug.

describe('unknown is a real answer, with a reason', () => {
  it.each([
    ['no Feed at all', {}, 'no-transfer-history'],
    ['null', null, 'no-transfer-history'],
    ['TransferHistory missing', { Feed: {} }, 'no-transfer-history'],
    ['TransferHistory empty', { Feed: { TransferHistory: [] } }, 'no-transfer-history'],
    ['TransferHistory not an array', { Feed: { TransferHistory: 'nope' } }, 'no-transfer-history'],
    ['no entry flagged current owner', { Feed: { TransferHistory: [{ CurrentOwnerFlag: 'False', Deed: { BuyerInfo: { Buyers: { Buyer: [{ LastOrCorporateName: 'X' }] } } } }] } }, 'no-current-owner-deed'],
    ['flagged entry carries no Deed', { Feed: { TransferHistory: [{ CurrentOwnerFlag: 'True' }] } }, 'no-current-owner-deed'],
    ['flagged entry is a Mortgage, not a Deed', { Feed: { TransferHistory: [{ CurrentOwnerFlag: 'True', Mortgage: {} }] } }, 'no-current-owner-deed'],
  ])('%s -> unknown (%s)', (_label, raw, reason) => {
    const r = deriveOwnerKind(raw);
    expect(r.kind).toBe('unknown');
    expect(r.reason).toBe(reason);
    expect(r.lastOrCorporateName).toBeNull();
  });

  it('an empty Buyer array is unknown, not entity', () => {
    const raw = { Feed: { TransferHistory: [{ CurrentOwnerFlag: 'True', Deed: { BuyerInfo: { Buyers: { Buyer: [] } } } }] } };
    // Buyers.Buyer exists but holds nobody — no party to read.
    expect(deriveOwnerKind(raw).kind).toBe('unknown');
  });

  it('skips flagged entries without a Deed to reach the one that has it', () => {
    const raw = { Feed: { TransferHistory: [
      { CurrentOwnerFlag: 'True', Mortgage: {} },
      { CurrentOwnerFlag: 'False', Deed: { BuyerInfo: { Buyers: { Buyer: [{ LastOrCorporateName: 'WRONG', FirstAndMiddleName: 'X' }] } } } },
      { CurrentOwnerFlag: 'True', Deed: { BuyerInfo: { Buyers: { Buyer: [{ LastOrCorporateName: '5558 RIVERTON LLC' }] } } } },
    ] } };
    const r = deriveOwnerKind(raw);
    expect(r.kind).toBe('entity');
    expect(r.lastOrCorporateName).toBe('5558 RIVERTON LLC');
  });
});

describe('against the real production payload', () => {
  const has = existsSync(ENTITY_PAYLOAD);
  it.runIf(has)('5558 RIVERTON LLC reads as an entity from the live response', () => {
    const raw = JSON.parse(readFileSync(ENTITY_PAYLOAD, 'utf8'));
    const r = deriveOwnerKind(raw);
    expect(r.kind).toBe('entity');
    expect(r.lastOrCorporateName).toBe('5558 RIVERTON LLC');
    expect(r.entityCode).toBe('LC');
    expect(r.entityCodeDesc).toBe('Limited Liability Company');
    expect(r.reason).toBe('first-and-middle-name-absent');
  });
});
