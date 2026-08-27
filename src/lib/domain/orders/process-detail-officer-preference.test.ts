import { describe, expect, it } from 'vitest';
import {
  resolveEscrowOfficerId,
  resolveOfficerIdByLookupCode,
  type ContactRecord,
} from './process-detail';

// The two rows Anna Ballesteros actually has, as measured 2026-08-27 21:37 UTC:
// 12 is SoftPro's officer-feed row (PRV, PCT\aballesteros), 17165 is the
// address-book row, which carries the same PCT\ code only because
// refreshOfficerContact stamped it there every time an order resolved to it.
const OFFICER_ROW: ContactRecord = {
  id: 12,
  firstName: null,
  lastName: null,
  fullName: 'Anna Ballesteros',
  officerName: 'Anna Ballesteros',
  softproLookupCode: 'PCT\\aballesteros',
  sourceId: 'PCT\\aballesteros',
  email: 'aballesteros@pct.com',
  phone: null,
  isInternalOfficerRow: true,
};

const ADDRESS_BOOK_ROW: ContactRecord = {
  ...OFFICER_ROW,
  id: 17165,
  email: 'aballesteros@pct.com',
  phone: '559-833-2740',
  isInternalOfficerRow: false,
};

// Paul Sepulveda: an outside escrow officer at another firm, 63 orders, no
// `PCT\` code and no office code. 719 candidates look like this and they are
// the majority of what arrives.
const EXTERNAL_OFFICER: ContactRecord = {
  id: 7228,
  firstName: 'Paul',
  lastName: 'Sepulveda',
  fullName: 'Paul Sepulveda',
  officerName: null,
  softproLookupCode: 'PauSepTheE',
  sourceId: 'PauSepTheE',
  email: 'paul@theescrowfirm.com',
  phone: null,
  isInternalOfficerRow: false,
};

// Joseph Gomez: officer-feed row 14 has no email (SoftPro column-shifted the
// vendor row). Address-book 10999 is jgomez@pct.com. Preferring 14 would
// blank prelim `to` on his 86 orders.
const GOMEZ_OFFICER: ContactRecord = {
  id: 14,
  firstName: null,
  lastName: null,
  fullName: 'Joseph Gomez',
  officerName: 'Joseph Gomez',
  softproLookupCode: 'PCT\\jgomez',
  sourceId: 'PCT\\jgomez',
  email: null,
  phone: null,
  isInternalOfficerRow: true,
};

const GOMEZ_ADDRESS_BOOK: ContactRecord = {
  ...GOMEZ_OFFICER,
  id: 10999,
  email: 'jgomez@pct.com',
  isInternalOfficerRow: false,
};

/** Every ordering of the same candidates, so no test passes by luck of order. */
function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const p of permutations(rest)) out.push([items[i]!, ...p]);
  }
  return out;
}

describe('escrow officer resolution when a person has both an officer row and an address-book row', () => {
  const both = [ADDRESS_BOOK_ROW, OFFICER_ROW, EXTERNAL_OFFICER];

  it('prefers the officer-feed row when both rows are present and the officer has a usable email', () => {
    expect(resolveEscrowOfficerId('Anna Ballesteros', both)).toBe(12);
    expect(resolveOfficerIdByLookupCode('PCT\\aballesteros', both)).toBe(12);
  });

  it('prefers the address-book row when both rows are present and the officer has no usable email', () => {
    const gomezBoth = [GOMEZ_ADDRESS_BOOK, GOMEZ_OFFICER, EXTERNAL_OFFICER];
    expect(resolveEscrowOfficerId('Joseph Gomez', gomezBoth)).toBe(10999);
    expect(resolveOfficerIdByLookupCode('PCT\\jgomez', gomezBoth)).toBe(10999);
    for (const candidates of permutations(gomezBoth)) {
      expect(resolveEscrowOfficerId('Joseph Gomez', candidates)).toBe(10999);
      expect(resolveOfficerIdByLookupCode('PCT\\jgomez', candidates)).toBe(10999);
    }
  });

  it('gives the same answer for every ordering of the candidates', () => {
    // The defect being avoided is an unordered `limit 1` — determinism that
    // survives only until someone reorders a clause. The preference is a
    // reduction over a total order, so candidate order cannot reach it.
    for (const candidates of permutations(both)) {
      expect(resolveEscrowOfficerId('Anna Ballesteros', candidates)).toBe(12);
      expect(resolveOfficerIdByLookupCode('PCT\\aballesteros', candidates)).toBe(12);
    }
  });

  it('still resolves an external officer who has no internal twin', () => {
    expect(resolveEscrowOfficerId('Paul Sepulveda', both)).toBe(7228);
    expect(resolveOfficerIdByLookupCode('PauSepTheE', both)).toBe(7228);
  });

  it('resolves the address-book row when the officer row is not a candidate', () => {
    // The union arm of loadEscrowOfficers is what puts row 12 in the set at
    // all: `is_escrow_officer` is false on it. Without that arm the preference
    // has nothing to prefer, which is the whole reason the loader unions.
    expect(resolveEscrowOfficerId('Anna Ballesteros', [ADDRESS_BOOK_ROW])).toBe(17165);
  });

  it('settles two equally external rows by lowest id rather than arrival order', () => {
    const twin: ContactRecord = { ...EXTERNAL_OFFICER, id: 22265 };
    expect(resolveEscrowOfficerId('Paul Sepulveda', [twin, EXTERNAL_OFFICER])).toBe(7228);
    expect(resolveEscrowOfficerId('Paul Sepulveda', [EXTERNAL_OFFICER, twin])).toBe(7228);
  });

  it('does not let the preference jump a tier', () => {
    // officerName is tier 1 and fullName is tier 2. A preferred row that only
    // matches on tier 2 must not beat a non-preferred row matching on tier 1,
    // or the preference would quietly rewrite the matching rules.
    const tierTwoInternal: ContactRecord = {
      ...OFFICER_ROW,
      id: 900,
      officerName: null,
      fullName: 'Rose Lucero',
    };
    const tierOneExternal: ContactRecord = {
      ...EXTERNAL_OFFICER,
      id: 901,
      officerName: 'Rose Lucero',
      fullName: null,
    };
    expect(resolveEscrowOfficerId('Rose Lucero', [tierTwoInternal, tierOneExternal])).toBe(901);
  });

  it('returns null only when nothing matches at all', () => {
    expect(resolveEscrowOfficerId('Nobody At All', both)).toBeNull();
    expect(resolveEscrowOfficerId('', both)).toBeNull();
    expect(resolveOfficerIdByLookupCode(null, both)).toBeNull();
  });
});
