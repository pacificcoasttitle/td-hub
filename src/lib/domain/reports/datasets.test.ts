import { describe, expect, it } from 'vitest';
import {
  classifyPropertyType,
  formatRouteId,
  median,
  medianPricePerSqft,
  monthKey,
  monthWindow,
  parseAreaSaleRows,
  parseCountySaleRows,
  parseRouteRows,
  standoutBy,
  shareOf,
  splitCsvLine,
  withinWindow,
} from './datasets';

// These tests are the three ported defects, written as the behaviour that
// replaces them. Each one names the thing legacy did.

describe('median means median', () => {
  it('is the middle value, not the average — the County column said Median and computed the mean', () => {
    // mean 300, median 150. Legacy printed 300 under a column labelled Median.
    expect(median([100, 150, 650])).toBe(150);
  });

  it('averages the two middle values on an even count', () => {
    expect(median([100, 200, 300, 400])).toBe(250);
  });

  it('is null for nothing, so an empty city prints an em dash rather than a zero', () => {
    expect(median([])).toBeNull();
  });

  it('price per square foot is the median of each home\'s own rate', () => {
    // Rates: 500, 400, 1000 → median 500. A ratio of sums would give ~483.
    const rows = [
      { price: 1_000_000, buildingArea: 2000 },
      { price: 800_000, buildingArea: 2000 },
      { price: 1_000_000, buildingArea: 1000 },
    ];
    expect(medianPricePerSqft(rows)).toBe(500);
    const ratioOfSums = (1_000_000 + 800_000 + 1_000_000) / (2000 + 2000 + 1000);
    expect(medianPricePerSqft(rows)).not.toBeCloseTo(ratioOfSums, 0);
  });

  it('a sale with no floor area contributes nothing, rather than a zero rate', () => {
    expect(medianPricePerSqft([
      { price: 1_000_000, buildingArea: 2000 },
      { price: 900_000, buildingArea: null },
      { price: 1_200_000, buildingArea: 2000 },
    ])).toBe(550);
  });

  it('a share is over what is KNOWN, so unknown occupancy does not read as owner-occupied', () => {
    expect(shareOf([true, false, null, null])).toBe(0.5);
    expect(shareOf([null, null])).toBeNull();
  });
});

describe('property types collapse, and rejects are counted', () => {
  it('reads both casings — legacy kept rcon and rsfr and dropped Condo and SFR in silence', () => {
    for (const raw of ['RSFR', 'rsfr', 'SFR', 'Single Family']) expect(classifyPropertyType(raw)).toBe('single_family');
    for (const raw of ['RCON', 'rcon', 'Condo', 'Condominium']) expect(classifyPropertyType(raw)).toBe('condominium');
  });

  it('returns null for a type it does not know, so the row can be counted rather than folded in', () => {
    expect(classifyPropertyType('Mineral Rights')).toBeNull();
    expect(classifyPropertyType('')).toBeNull();
  });

  it('counts every rejected row against the value that caused it', () => {
    // Appendix A: Site City, Purchase Price, Property Type.
    const csv = [
      'Site City,Purchase Price,Property Type',
      'Irvine,1250000,rsfr',
      'Irvine,720000,rcon',
      'Newport Beach,2100000,RSFR',
      'Newport Beach,800000,Mineral Rights',
      'Newport Beach,700000,',
      ',650000,rsfr',
    ].join('\n');
    const out = parseCountySaleRows(csv);
    expect(out.total).toBe(6);
    expect(out.used).toBe(3);
    expect(out.rejectedTypes).toEqual({ 'Mineral Rights': 1, '(blank type)': 1, '(no city)': 1 });
  });

  it('keeps SFR, which legacy dropped — the guide says so in as many words', () => {
    // "RSFR survives because it lowercases to rsfr. SFR does not."
    const out = parseCountySaleRows('Site City,Purchase Price,Property Type\nIrvine,900000,SFR');
    expect(out.used).toBe(1);
    expect(out.rows[0]!.propertyKind).toBe('single_family');
  });
});

describe('the dataset is the interface, not the file', () => {
  it('reads the county file exactly as Appendix A prints it', () => {
    const out = parseCountySaleRows('Site City,Purchase Price,Property Type\nIrvine,1250000,rsfr');
    expect(out.rows[0]).toEqual({ city: 'Irvine', price: 1_250_000, propertyKind: 'single_family' });
    expect(out.missingFields).toEqual([]);
  });

  it('reads the sales-activity file, whose headers are a DIFFERENT set', () => {
    // APN / Parcel Number, Bedrooms, Baths, Building Size, Owner Occupied,
    // Purchase Price, Purchase Date — no city, no property type.
    const csv = [
      'APN / Parcel Number,Bedrooms,Baths,Building Size,Owner Occupied,Purchase Price,Purchase Date',
      '123-456-789,3,2,1600,Y,1200000,2026-08-04',
      '123-456-790,2,2,1180,n,980000,2026-07-19',
    ].join('\n');
    const out = parseAreaSaleRows(csv);
    expect(out.used).toBe(2);
    expect(out.missingFields).toEqual([]);
    expect(out.rows[0]).toMatchObject({ apn: '123-456-789', beds: 3, baths: 2, buildingArea: 1600, ownerOccupied: true, price: 1_200_000 });
    expect(out.rows[1]!.ownerOccupied).toBe(false);
    expect(out.rows[0]!.saleDate.toISOString().slice(0, 10)).toBe('2026-08-04');
  });

  it('reports a header it cannot place rather than ignoring it', () => {
    const out = parseCountySaleRows('Site City,Purchase Price,Property Type,Parcel Shape\nIrvine,850000,rsfr,irregular');
    expect(out.unmappedHeaders).toEqual(['Parcel Shape']);
  });

  it('says which required field no header supplied', () => {
    expect(parseCountySaleRows('Site City,Property Type\nIrvine,rsfr').missingFields).toContain('price');
    expect(parseAreaSaleRows('Bedrooms,Baths\n3,2').missingFields).toEqual(['price', 'saleDate']);
  });

  it('rejects a sale with no date, because a window cannot place it', () => {
    const out = parseAreaSaleRows('Purchase Price,Purchase Date\n1200000,2026-08-04\n980000,');
    expect(out.used).toBe(1);
    expect(out.rejectedTypes).toEqual({ '(no purchase date)': 1 });
  });

  it('reads prices with currency and thousands separators', () => {
    expect(parseCountySaleRows('Site City,Purchase Price,Property Type\nIrvine,"$1,250,000",rsfr').rows[0]!.price).toBe(1_250_000);
  });

  it('keeps commas inside quoted fields', () => {
    expect(splitCsvLine('a,"b,c",d')).toEqual(['a', 'b,c', 'd']);
  });

  it('reads owner occupancy in the spellings the feeds use', () => {
    const csv = 'Purchase Price,Purchase Date,Owner Occupied\n1,2026-08-01,Y\n2,2026-08-01,absentee\n3,2026-08-01,maybe';
    expect(parseAreaSaleRows(csv).rows.map((r: { ownerOccupied: boolean | null }) => r.ownerOccupied)).toEqual([true, false, null]);
  });
});

describe('route metrics are ranked and formatted, never recomputed', () => {
  it('hyphenates after the ZIP when the ZIP is known — not after five characters', () => {
    expect(formatRouteId('904031C001', '90403')).toBe('90403-1C001');
    // A six-character ZIP-less id: the rule is four from the END, and the
    // naive "after five" split would put the hyphen in the wrong place.
    expect(formatRouteId('12345678')).toBe('1234-5678');
    expect(formatRouteId('904031C001')).toBe('904031-C001');
    expect(formatRouteId('1C001')).toBe('1C001');
  });

  it('parses the pre-aggregated row under the feed\'s own names', () => {
    const csv = [
      'carrier_route,avg_price,turnover_rate,total_sales,NOO_ratio,avg_yr_owned,total_units,sa_site_zip,sa_site_city',
      '904031C001,1840000,8.4,19,41,11.2,420,90403,Santa Monica',
    ].join('\n');
    const out = parseRouteRows(csv);
    expect(out.missingFields).toEqual([]);
    expect(out.rows[0]).toEqual({
      routeId: '90403-1C001', zip: '90403', city: 'Santa Monica',
      totalUnits: 420, totalSales: 19, avgPrice: 1_840_000,
      turnoverRate: 8.4, nonOwnerRatio: 41, avgYearsOwned: 11.2,
    });
  });

  it('names the price field AVERAGE, because that is what the feed sends', () => {
    // The field name is the guard: nothing downstream can print avg_price under
    // a column that says median, which is the defect being fixed in County Sales.
    const row = parseRouteRows('carrier_route,avg_price\n904031C001,1840000').rows[0]!;
    expect(row).toHaveProperty('avgPrice');
    expect(row).not.toHaveProperty('medianPrice');
  });

  it('rejects and counts a row with no route id', () => {
    const out = parseRouteRows('carrier_route,total_units\n,412\n904031C001,300');
    expect(out.used).toBe(1);
    expect(out.rejectedTypes).toEqual({ '(blank route id)': 1 });
  });

  it('computes each standout from ITS OWN field', () => {
    // Legacy's HIGHEST NON-OWNER tile printed the turnover winner's route
    // beside the non-owner percentage.
    const rows = parseRouteRows([
      'carrier_route,avg_price,turnover_rate,NOO_ratio,sa_site_zip',
      '904031C001,1000000,9.9,20,90403',
      '904032C004,2000000,4.0,71,90403',
    ].join('\n')).rows;
    expect(standoutBy(rows, (r) => r.turnoverRate)!.routeId).toBe('90403-1C001');
    expect(standoutBy(rows, (r) => r.nonOwnerRatio)!.routeId).toBe('90403-2C004');
    expect(standoutBy(rows, (r) => r.avgPrice)!.routeId).toBe('90403-2C004');
  });

  it('ignores a missing value rather than treating it as a zero winner', () => {
    const rows = parseRouteRows('carrier_route,NOO_ratio\n904031C001,\n904032C004,12').rows;
    expect(standoutBy(rows, (r) => r.nonOwnerRatio)!.routeId).toBe('904032-C004');
    expect(standoutBy([], (r: { nonOwnerRatio: number | null }) => r.nonOwnerRatio)).toBeNull();
  });
});

describe('a window is a date range', () => {
  it('covers the whole span, ending on the last day of the month', () => {
    const w = monthWindow(new Date(Date.UTC(2026, 7, 1)), 6); // August 2026, 6 months
    expect(w.start.toISOString().slice(0, 10)).toBe('2026-03-01');
    expect(w.end.toISOString().slice(0, 10)).toBe('2026-08-31');
  });

  it('excludes the same month in a different year — legacy matched the month NUMBER', () => {
    const w = monthWindow(new Date(Date.UTC(2026, 7, 1)), 12);
    expect(withinWindow(new Date(Date.UTC(2026, 7, 15)), w)).toBe(true);
    expect(withinWindow(new Date(Date.UTC(2024, 7, 15)), w)).toBe(false);
    // 12 months ending August 2026 starts in SEPTEMBER 2025, so the previous
    // August is outside it — which is exactly the row legacy pulled in.
    expect(withinWindow(new Date(Date.UTC(2025, 7, 15)), w)).toBe(false);
    expect(withinWindow(new Date(Date.UTC(2025, 8, 15)), w)).toBe(true);
    expect(withinWindow(new Date(Date.UTC(2025, 8, 15)), monthWindow(new Date(Date.UTC(2026, 7, 1)), 6))).toBe(false);
  });

  it('a row with no sale date is outside every window rather than counted', () => {
    expect(withinWindow(null, monthWindow(new Date(Date.UTC(2026, 7, 1)), 6))).toBe(false);
  });

  it('groups by month WITH the year', () => {
    expect(monthKey(new Date(Date.UTC(2026, 7, 15)))).toBe('2026-08');
    expect(monthKey(new Date(Date.UTC(2025, 7, 15)))).not.toBe(monthKey(new Date(Date.UTC(2026, 7, 15))));
  });
});
