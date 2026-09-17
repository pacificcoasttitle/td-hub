import { describe, expect, it } from 'vitest';
import {
  AREA_MEDIAN_NOTE,
  COUNTY_MEDIAN_NOTE,
  ROUTE_AVERAGE_NOTE,
  ROUTE_COLUMN_DEFINITIONS,
  ROUTE_STANDOUT_NOTE,
} from './definitions';
import { parseRouteRows } from './datasets';

// Both decisions, 2026-09-17, written as assertions rather than prose in a
// ticket: a label that drifts from its maths is the defect being fixed.

describe('the route report calls an average an average', () => {
  it('says the figures are averages from the source, and does not claim a median', () => {
    expect(ROUTE_AVERAGE_NOTE).toMatch(/route averages supplied by the source data/i);
    expect(ROUTE_AVERAGE_NOTE).toMatch(/not medians/i);
  });

  it('explains WHY, so the next person does not "fix" the label back', () => {
    expect(ROUTE_AVERAGE_NOTE).toMatch(/individual sales .* not included/i);
  });

  it('and the field it describes is named for what it holds', () => {
    const row = parseRouteRows('carrier_route,avg_price,avg_yr_owned\n904031C001,1840000,11.2').rows[0]!;
    expect(row).toMatchObject({ avgPrice: 1_840_000, avgYearsOwned: 11.2 });
    expect(row).not.toHaveProperty('medianPrice');
  });
});

describe('the highlights are the best of the ten shown', () => {
  it('says so on the page, rather than leaving the scope to be assumed', () => {
    expect(ROUTE_STANDOUT_NOTE).toMatch(/best of the ten routes shown/i);
    expect(ROUTE_STANDOUT_NOTE).toMatch(/not of the whole area/i);
  });

  it('tells the reader how to get the area leader instead', () => {
    expect(ROUTE_STANDOUT_NOTE).toMatch(/sorted by that measure/i);
  });
});

describe('the reports we compute ourselves say median, and mean it', () => {
  it('county prices are medians of individual sales', () => {
    expect(COUNTY_MEDIAN_NOTE).toMatch(/median of the individual sales/i);
    expect(COUNTY_MEDIAN_NOTE).toMatch(/not an average/i);
  });

  it('price per square foot is each home\'s own rate, not a ratio of totals', () => {
    expect(AREA_MEDIAN_NOTE).toMatch(/median of each home's own rate/i);
    expect(AREA_MEDIAN_NOTE).toMatch(/not total price divided by total area/i);
  });
});

describe('the three definitions the route page carries', () => {
  it('covers the three columns an agent reads, in plain words', () => {
    expect(ROUTE_COLUMN_DEFINITIONS.map((d) => d.term)).toEqual(['Turnover', 'Non-owner', 'Units']);
    for (const d of ROUTE_COLUMN_DEFINITIONS) {
      expect(d.meaning.length).toBeGreaterThan(30);
      expect(d.meaning).not.toMatch(/ratio|coefficient|aggregate/i);
    }
  });
});
