import { describe, expect, it } from 'vitest';
import { carrierRouteFigures, countySalesFigures, salesActivityFigures } from './stored-figures';

// These replaced `as never` on every stored-figure read in rerenderFarming.
// The cast is the mechanism that hid the Concierge comp mapping dropping five
// fields: nothing asks, so a missing value arrives as undefined and prints as
// a blank page rather than failing.
//
// The template-version check upstream is the real guard. This is the second
// line, for a row that passes it and still holds figures a bug wrote.

describe('sales activity figures', () => {
  it('accepts the shape the document reads', () => {
    const r = salesActivityFigures({ homesSold: 239 }, [{ key: '2026-08' }]);
    expect(r.ok).toBe(true);
  });

  it('refuses null metrics by name, rather than rendering a blank page', () => {
    expect(salesActivityFigures(null, [])).toEqual({ ok: false, missing: 'metrics' });
  });

  it('refuses months that are not a list', () => {
    // An object here would iterate as nothing and print an empty table.
    expect(salesActivityFigures({}, {})).toEqual({ ok: false, missing: 'months' });
    expect(salesActivityFigures({}, null)).toEqual({ ok: false, missing: 'months' });
  });

  it('does not mistake an array for the metrics object', () => {
    expect(salesActivityFigures([], [])).toEqual({ ok: false, missing: 'metrics' });
  });

  it('accepts an empty months list, which is a real answer', () => {
    // A window with no sales in it is legitimate and prints as such.
    expect(salesActivityFigures({ homesSold: 0 }, []).ok).toBe(true);
  });
});

describe('carrier route figures', () => {
  it('accepts routes and standouts', () => {
    expect(carrierRouteFigures([{ routeId: '91750-C001' }], { turnover: {} }, 24).ok).toBe(true);
  });

  it('refuses routes that are not a list', () => {
    expect(carrierRouteFigures(null, {}, 0)).toEqual({ ok: false, missing: 'routes' });
  });

  it('refuses missing standouts, which are six tiles on the page', () => {
    expect(carrierRouteFigures([], null, 0)).toEqual({ ok: false, missing: 'standouts' });
  });

  it('carries the total through, since it is not stored with the figures', () => {
    const r = carrierRouteFigures([], {}, 38);
    expect(r.ok && r.figures.totalRoutes).toBe(38);
  });
});

describe('county sales figures', () => {
  const totals = { houses: { sold: 1610, medianPrice: 625_000 }, condos: { sold: 298, medianPrice: 481_000 } };

  it('accepts cities and both kind totals', () => {
    expect(countySalesFigures([{ city: 'Riverside' }], totals).ok).toBe(true);
  });

  it('refuses a totals object missing a column the page prints', () => {
    // Houses and Condominiums are both column groups; one missing is half the
    // table rendering as blanks.
    expect(countySalesFigures([], { houses: totals.houses })).toEqual({ ok: false, missing: 'totals.condos' });
    expect(countySalesFigures([], { condos: totals.condos })).toEqual({ ok: false, missing: 'totals.houses' });
  });

  it('refuses cities that are not a list', () => {
    expect(countySalesFigures(null, totals)).toEqual({ ok: false, missing: 'cities' });
  });

  it('treats a missing otherKinds as empty, because absent and none are the same thing', () => {
    // A county month where every sale was a house or a condominium has no
    // other kinds, and the document prints nothing for it either way.
    const r = countySalesFigures([], totals);
    expect(r.ok && r.figures.otherKinds).toEqual({});
  });

  it('keeps otherKinds when it is there', () => {
    const r = countySalesFigures([], { ...totals, otherKinds: { multi_family: 4 } });
    expect(r.ok && r.figures.otherKinds).toEqual({ multi_family: 4 });
  });
});
