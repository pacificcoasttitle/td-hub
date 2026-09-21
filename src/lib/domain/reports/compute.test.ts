import { describe, expect, it } from 'vitest';
import { monthWindow, type AreaSaleRow, type CountySaleRow, type RouteRow } from './datasets';
import {
  computeCarrierRoute, computeCountySales, computeSalesActivity, monthLabel, windowMonths,
} from './compute';

const sale = (iso: string, price: number, over: Partial<AreaSaleRow> = {}): AreaSaleRow => ({
  apn: null, price, saleDate: new Date(iso + 'T12:00:00Z'),
  buildingArea: 1000, beds: 3, baths: 2, ownerOccupied: true, ...over,
});

const AUG_2026 = new Date(Date.UTC(2026, 7, 1));

describe('Sales Activity', () => {
  it('keeps sales by DATE, not by month number', () => {
    // Legacy kept any row whose month number was in the lookback, so a 12-month
    // run mixed August 2024, 2025 and 2026 into one figure.
    const w = monthWindow(AUG_2026, 12);
    const f = computeSalesActivity([
      sale('2026-08-10', 1_000_000),
      // The window is September 2025 to August 2026, so both earlier Augusts
      // are outside it — though their month number matches.
      sale('2025-08-10', 900_000),
      sale('2024-08-10', 800_000),
    ], w);
    expect(f.metrics.homesSold).toBe(1);
    expect(f.metrics.outsideWindow).toBe(2);
  });

  it('reports a TRUE median price, not the mean legacy printed under that word', () => {
    const w = monthWindow(AUG_2026, 3);
    const f = computeSalesActivity([
      sale('2026-08-01', 800_000), sale('2026-08-02', 900_000), sale('2026-08-03', 2_100_000),
    ], w);
    expect(f.metrics.medianPrice).toBe(900_000);          // the mean would be 1,266,667
  });

  it('takes the median of each home\'s own $/sq ft, not a ratio of sums', () => {
    const w = monthWindow(AUG_2026, 3);
    const f = computeSalesActivity([
      sale('2026-08-01', 1_000_000, { buildingArea: 1000 }),  // $1,000
      sale('2026-08-02', 600_000, { buildingArea: 1500 }),    // $400
      sale('2026-08-03', 3_000_000, { buildingArea: 5000 }),  // $600
    ], w);
    expect(f.metrics.medianPricePerSqft).toBe(600);           // sum/sum would be $615
  });

  it('takes the non-occupant share over sales where occupancy is KNOWN', () => {
    const w = monthWindow(AUG_2026, 3);
    const f = computeSalesActivity([
      sale('2026-08-01', 1, { ownerOccupied: false }),
      sale('2026-08-02', 1, { ownerOccupied: true }),
      sale('2026-08-03', 1, { ownerOccupied: null }),
    ], w);
    expect(f.metrics.nonOccupantShare).toBe(0.5);
    expect(f.metrics.occupancyKnown).toBe(2);
  });

  it('lists every month in the window newest first, empty ones included', () => {
    const w = monthWindow(AUG_2026, 3);
    const f = computeSalesActivity([sale('2026-08-01', 1_000_000), sale('2026-06-01', 900_000)], w);
    expect(f.months.map((m) => m.key)).toEqual(['2026-08', '2026-07', '2026-06']);
    expect(f.months[1]).toMatchObject({ sales: 0, medianPrice: null, medianPricePerSqft: null });
  });

  it('measures change against the previous month, with none on the oldest and none across a gap', () => {
    const w = monthWindow(AUG_2026, 3);
    const f = computeSalesActivity([
      sale('2026-06-01', 760_000), sale('2026-08-01', 783_000),
    ], w);
    const [aug, jul, jun] = f.months;
    expect(jun!.changePct).toBeNull();          // oldest
    expect(jul!.changePct).toBeNull();          // no sales in July
    expect(aug!.changePct).toBeNull();          // a change from nothing is not a change
  });

  it('computes the change the guide\'s worked example gives', () => {
    const w = monthWindow(new Date(Date.UTC(2026, 6, 1)), 2);
    const f = computeSalesActivity([sale('2026-06-01', 760_000), sale('2026-07-01', 783_000)], w);
    expect(f.months[0]!.changePct).toBeCloseTo(3.026, 3);
  });

  it('spans the window by calendar month, across a year end', () => {
    expect(windowMonths(monthWindow(new Date(Date.UTC(2026, 1, 1)), 4)))
      .toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect(monthLabel('2025-11')).toBe('November 2025');
  });
});

const route = (routeId: string, over: Partial<RouteRow> = {}): RouteRow => ({
  routeId, zip: '90403', city: 'Santa Monica', totalUnits: 300, totalSales: 10,
  avgPrice: 1_500_000, turnoverRate: 5, nonOwnerRatio: 20, avgYearsOwned: 12, ...over,
});

describe('Carrier Route Analysis', () => {
  it('prints each standout with the route that won ITS OWN measure', () => {
    // Legacy printed the turnover winner's route under the non-owner figure.
    const f = computeCarrierRoute([
      route('90403-C001', { turnoverRate: 9, nonOwnerRatio: 10 }),
      route('90403-C002', { turnoverRate: 3, nonOwnerRatio: 55 }),
    ], 'turnover');
    expect(f.standouts.turnover).toEqual({ routeId: '90403-C001', value: 9 });
    expect(f.standouts.nonOwner).toEqual({ routeId: '90403-C002', value: 55 });
  });

  it('ranks by the chosen measure and keeps ten', () => {
    const rows = Array.from({ length: 14 }, (_, i) => route(`R${String(i).padStart(2, '0')}`, { totalSales: i }));
    const f = computeCarrierRoute(rows, 'sales');
    expect(f.routes).toHaveLength(10);
    expect(f.routes[0]!.routeId).toBe('R13');
    expect(f.totalRoutes).toBe(14);
  });

  it('takes standouts from the ten SHOWN, never from a route the page does not print', () => {
    const rows = [
      ...Array.from({ length: 10 }, (_, i) => route(`TOP${i}`, { totalSales: 100 + i, nonOwnerRatio: 20 })),
      route('ELEVENTH', { totalSales: 1, nonOwnerRatio: 99 }),
    ];
    const f = computeCarrierRoute(rows, 'sales');
    expect(f.routes.map((r) => r.routeId)).not.toContain('ELEVENTH');
    expect(f.standouts.nonOwner!.routeId).not.toBe('ELEVENTH');
  });

  it('puts a route with no figure for the ranking measure last, not at zero', () => {
    const f = computeCarrierRoute([route('A', { turnoverRate: null }), route('B', { turnoverRate: 1 })], 'turnover');
    expect(f.routes.map((r) => r.routeId)).toEqual(['B', 'A']);
  });

  it('leaves a standout empty when no shown route has that figure', () => {
    const f = computeCarrierRoute([route('A', { avgYearsOwned: null })], 'turnover');
    expect(f.standouts.yearsHeld).toBeNull();
  });
});

const csale = (city: string, price: number, propertyKind: CountySaleRow['propertyKind'] = 'single_family'): CountySaleRow =>
  ({ city, price, propertyKind });

describe('County Sales', () => {
  it('treats IRVINE and Irvine as one city, printed the way the file mostly spells it', () => {
    const f = computeCountySales([csale('Irvine', 1), csale('IRVINE', 2), csale('Irvine', 3)]);
    expect(f.cities).toHaveLength(1);
    expect(f.cities[0]!.city).toBe('Irvine');
    expect(f.cities[0]!.houses.sold).toBe(3);
  });

  it('title-cases a city only when every row shouted', () => {
    expect(computeCountySales([csale('LA HABRA', 1)]).cities[0]!.city).toBe('La Habra');
  });

  it('sorts as a reader would, not by ASCII', () => {
    // Legacy's ksort put "Yorba Linda" above "anaheim".
    const f = computeCountySales([csale('Yorba Linda', 1), csale('anaheim', 1), csale('Brea', 1)]);
    expect(f.cities.map((c) => c.city)).toEqual(['Anaheim', 'Brea', 'Yorba Linda']);
  });

  it('prints a true median per city — the column legacy labelled Median and averaged', () => {
    const f = computeCountySales([csale('Irvine', 800_000), csale('Irvine', 900_000), csale('Irvine', 2_100_000)]);
    expect(f.cities[0]!.houses.medianPrice).toBe(900_000);
  });

  it('computes the county total from the sales, not from the city medians', () => {
    const f = computeCountySales([
      csale('A', 100), csale('A', 200), csale('A', 300),   // city median 200
      csale('B', 1_000),                                    // city median 1,000
    ]);
    // Median of the four sales is 250; the median of the two city medians is 600.
    expect(f.totals.houses).toEqual({ sold: 4, medianPrice: 250 });
  });

  it('keeps houses and condominiums apart and leaves an empty group empty', () => {
    const f = computeCountySales([csale('Irvine', 1_250_000), csale('Irvine', 720_000, 'condominium'), csale('Tustin', 900_000)]);
    const tustin = f.cities.find((c) => c.city === 'Tustin')!;
    expect(tustin.condos).toEqual({ sold: 0, medianPrice: null });
  });

  it('counts recognised types that have no column, instead of dropping them', () => {
    const f = computeCountySales([csale('Irvine', 1), csale('Irvine', 2, 'multi_family'), csale('Irvine', 3, 'land'), csale('Irvine', 4, 'land')]);
    expect(f.otherKinds).toEqual({ multi_family: 1, land: 2 });
  });

  it('does not list a city whose only sales have no column', () => {
    const f = computeCountySales([csale('Irvine', 1), csale('Villa Park', 2, 'land')]);
    expect(f.cities.map((c) => c.city)).toEqual(['Irvine']);
  });
});
