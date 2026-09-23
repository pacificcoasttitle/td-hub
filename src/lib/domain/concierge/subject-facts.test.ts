import { describe, expect, it } from 'vitest';
import {
  SUBJECT_FACT_FIELDS, subjectFactColumns, subjectFactsFromPayload, subjectFactsFromRow,
} from './subject-facts';
import type { NormalizedSubject } from './normalize';

// The second round-trip pair. Same shape as comp-row.test.ts, worse blast
// radius: these four fields decide WHICH COMPARABLES APPEAR, so a divergence
// does not change a label — it changes the set of sales on three pages, while
// page 8 still prints the criteria that were supposed to produce them.

const subject = {
  buildingArea: 786,
  beds: 2,
  baths: 1.5,
  useDescription: 'Single Family Residential',
} as NormalizedSubject;

describe('the subject facts survive the round trip', () => {
  const fromPayload = subjectFactsFromPayload(subject);
  const fromRow = subjectFactsFromRow(subjectFactColumns(subject));

  it.each(SUBJECT_FACT_FIELDS)('agrees on %s', (field) => {
    expect(fromRow[field], `${field} differs between generating and re-rendering — `
      + 're-rendering this profile would select a different set of comparables')
      .toEqual(fromPayload[field]);
  });

  it('agrees on the whole object, not just the fields we listed', () => {
    expect(fromRow).toEqual(fromPayload);
  });

  it('checks a fixture that is actually populated', () => {
    // All-null would pass every assertion above and prove nothing.
    for (const f of SUBJECT_FACT_FIELDS) {
      expect(fromPayload[f], `${f} must be set in the fixture`).not.toBeNull();
    }
  });

  it('keeps a fractional bath, which the numeric column round-trips as text', () => {
    // 1.5 → "1.5" → 1.5. An integer cast here would silently turn every
    // half-bath property into a whole one and change the size comparison.
    expect(fromRow.baths).toBe(1.5);
  });
});

describe('absences stay absent', () => {
  const empty = { buildingArea: null, beds: null, baths: null, useDescription: null } as NormalizedSubject;
  const fromRow = subjectFactsFromRow(subjectFactColumns(empty));

  it.each(SUBJECT_FACT_FIELDS)('keeps %s null', (field) => {
    // A null building area must not arrive as 0: the size rule would then
    // compare every comparable against a zero-square-foot subject and exclude
    // all of them, producing an empty report rather than an unfiltered one.
    expect(fromRow[field]).toBeNull();
  });
});
