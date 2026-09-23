import { describe, expect, it } from 'vitest';
import { COMP_DOCUMENT_FIELDS, compFromRow, compRowValues, type CompForDocument } from './comp-row';
import type { NormalizedComp } from './normalize';

// ─── The two paths must build the same document ─────────────────────────────
//
// THIS IS THE CLASS, NOT THE INSTANCE.
//
// The Concierge document is built twice, from two different sources:
//
//   generate   payload → normalizeComps → candidates → document
//   re-render  stored comp rows → candidates → document
//
// They are supposed to agree. Nothing made them, so any field present in one
// and absent from the other diverged in silence. The comp ADDRESS was the
// first one where it showed, and only because the v2 layout started printing
// it — profile #4 re-rendered as "Comparable 1 … Comparable 4" where its first
// render said "1481 BONITA AVE". It had been wrong for as long as it existed.
//
// Fixing the address fixed one field. This fixes the class: everything a
// comparable carries into the document must survive a write and a read back.
// A field added to COMP_DOCUMENT_FIELDS and forgotten in either mapping fails
// here, before a document goes out without it.

/** A comparable with every field populated and distinguishable. */
const full: NormalizedComp = {
  sourcePosition: 3,
  salePrice: 725_000,
  pricePerSqft: 802.5,
  buildingArea: 904,
  bedrooms: 2,
  baths: 1.5,
  yearBuilt: 1946,
  lotSize: 6_155,
  proximityMiles: 0.41,
  recordingDate: '2026-05-04',
  useCodeDescription: 'Single Family Residential',
  address: '1811 BONITA AVE',
  city: 'LA VERNE',
  state: 'CA',
  zip: '91750',
  apn: '8381-021-014',
  documentNumber: '26-0551234',
  documentType: 'Deed',
  latitude: 34.100_123,
  longitude: -117.770_456,
  raw: { SiteAddress: '1811 BONITA AVE' } as never,
};

const decision = { selected: true, exclusionReason: null, displayPosition: 1 };

/** Write it, read it back — exactly as the two paths do. */
const roundTrip = (c: NormalizedComp) => {
  const row = compRowValues(c, decision, 42);
  // The row as the database hands it back: `id` from the insert, everything
  // else as written. Numeric columns come back as strings, which is why the
  // inverse converts rather than casts.
  return compFromRow({ ...row, id: 7 });
};

describe('a comparable survives the round trip', () => {
  const back = roundTrip(full);

  it.each(COMP_DOCUMENT_FIELDS)('keeps %s', (field) => {
    expect(back[field], `${field} is lost between writing a comp row and reading it back`)
      .toEqual(full[field as keyof NormalizedComp]);
  });

  it('checks a field list that is actually populated', () => {
    // A fixture with nulls everywhere would pass every assertion above while
    // proving nothing.
    for (const f of COMP_DOCUMENT_FIELDS) {
      expect(full[f as keyof NormalizedComp], `${f} must be set in the fixture`).not.toBeNull();
    }
    expect(COMP_DOCUMENT_FIELDS.length).toBeGreaterThan(15);
  });

  it('carries the row id through, which the criteria panel needs', () => {
    expect(back.rowId).toBe(7);
  });
});

describe('the fields the document actually reads are all in the list', () => {
  // The list is the contract. If the document starts reading a field that is
  // not here, the round trip does not cover it — so the list is checked
  // against the type rather than maintained by memory.
  it('names every field of CompForDocument except the ones we deliberately drop', () => {
    const listed = new Set<string>(COMP_DOCUMENT_FIELDS);
    const onType = Object.keys(roundTrip(full)) as (keyof CompForDocument | 'rowId')[];
    const missing = onType.filter((k) => k !== 'rowId' && !listed.has(k));
    expect(missing, 'these survive the round trip but are not asserted by it — add them to COMP_DOCUMENT_FIELDS')
      .toEqual([]);
  });
});

describe('nulls stay null rather than becoming zero', () => {
  // A comp with no price must not arrive as $0 — the document prints an em
  // dash for a missing figure, and 0 would render as a real sale at nothing.
  const empty: NormalizedComp = {
    ...full,
    salePrice: null, pricePerSqft: null, buildingArea: null, bedrooms: null,
    baths: null, yearBuilt: null, lotSize: null, proximityMiles: null,
    recordingDate: null, useCodeDescription: null, address: null, city: null,
    state: null, zip: null, apn: null, documentNumber: null, documentType: null,
    latitude: null, longitude: null,
  };
  const back = roundTrip(empty);

  it.each(COMP_DOCUMENT_FIELDS.filter((f) => f !== 'sourcePosition'))('keeps %s null', (field) => {
    expect(back[field]).toBeNull();
  });
});

describe('the decision is written as the constraint requires', () => {
  it('clears the exclusion reason on a selected comp', () => {
    const row = compRowValues(full, { selected: true, exclusionReason: 'too_far', displayPosition: 2 }, 1);
    expect(row.selected).toBe(true);
    expect(row.exclusionReason).toBeNull();
    expect(row.displayPosition).toBe(2);
  });

  it('clears the display position on an excluded comp', () => {
    // `selected = false` with a display position would be a row claiming a
    // place on a page it is not on.
    const row = compRowValues(full, { selected: false, exclusionReason: 'too_far', displayPosition: 2 }, 1);
    expect(row.exclusionReason).toBe('too_far');
    expect(row.displayPosition).toBeNull();
  });
});
