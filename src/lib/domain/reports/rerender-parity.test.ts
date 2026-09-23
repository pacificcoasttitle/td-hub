import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseRouteRows } from './datasets';
import { TEMPLATE_FOR } from './generate';
import { computeCarrierRoute } from './compute';

// ─── The farming re-render, surveyed ────────────────────────────────────────
//
// The concierge document had two generate/re-render pairs that could diverge
// silently (comp-row.ts, subject-facts.ts). The farming reports were built the
// same week by the same pattern, so they were surveyed for the same class.
//
// THEY ARE MOSTLY IMMUNE, FOR A STRUCTURAL REASON WORTH RECORDING: the farming
// re-render does NOT recompute. It renders the FIGURES stored on the row —
// metrics, months, routes, standouts, cities, totals — so there is no second
// computation to disagree with the first. The concierge re-render recomputes
// from stored comps, which is why it needed holding together.
//
// Two fields are nonetheless RECONSTRUCTED on the read side rather than read,
// and those are this file's subject. Both are correct today; neither was
// pinned, and "correct today" is how the comp address started.

describe('carrier route: the total the re-render substitutes', () => {
  // rerenderFarming passes `totalRoutes: row.datasetUsed`, where the first
  // render passed computeCarrierRoute(rows).totalRoutes — which is rows.length.
  // The two agree only because every parsed row becomes a route. If the
  // compute step ever drops a row (a route with no usable figure, say), the
  // re-rendered page would report a different total from the original.
  const csv = [
    'carrier_route,avg_price,turnover_rate,total_sales,NOO_ratio,avg_yr_owned,total_units,sa_site_zip,sa_site_city',
    '91750C001,628000,4.2,11,8.1,15.0,402,91750,LA VERNE',
    '91750C002,621750,3.8,9,7.2,16.4,388,91750,LA VERNE',
    // A BLANK ROUTE ID is the only thing parseRouteRows rejects — blank
    // figures are kept as nulls. A row of empty figures left total === used
    // and made the assertion below vacuous, which the fixture check caught.
    ',735000,5.1,14,6.0,12.2,410,91750,LA VERNE',
    '91750C022,960000,8.55,42,7.94,17.8,491,91750,LA VERNE',
    // Parses fine, but carries NO average price. This is the row that makes
    // the assertion real: a compute step that started skipping routes with a
    // missing figure would drop this one and diverge from datasetUsed.
    '91750C030,,2.9,6,9.4,19.1,377,91750,LA VERNE',
  ].join('\n');

  const parsed = parseRouteRows(csv);
  const figures = computeCarrierRoute(parsed.rows, 'price');

  it('equals the dataset count the row stores, which is what a re-render reads', () => {
    expect(figures.totalRoutes, 'rerenderFarming substitutes row.datasetUsed for this. '
      + 'They have diverged — a re-rendered carrier route report now states a different '
      + 'number of routes than the document first issued.')
      .toBe(parsed.used);
  });

  it('is measured on a file that actually exercises the difference', () => {
    // A file where nothing is rejected would make the assertion vacuous: used
    // would equal the row count whatever compute did.
    expect(parsed.total).toBeGreaterThan(parsed.used);
    expect(parsed.rejected).toBeGreaterThan(0);
  });
});

describe('sales activity: the window key the re-render rebuilds', () => {
  // rerenderFarming rebuilds windowEndKey as String(row.windowEnd).slice(0, 7)
  // from a `date` column, where the first render passed the "YYYY-MM" key
  // straight through. That is only correct while drizzle's date() returns a
  // STRING — checked against production, where it returns "2025-08-01". If it
  // ever returned a Date, String() would give "Thu Aug 01 2026 …" and the
  // slice would print "Thu Aug" as the month on a re-rendered report.
  const fromDateColumn = (stored: string) => String(stored).slice(0, 7);

  it('recovers the month key from the stored date', () => {
    expect(fromDateColumn('2026-08-01')).toBe('2026-08');
  });

  it('would be caught if the column ever handed back a Date', () => {
    // Not an assertion about today's behaviour — a demonstration of what the
    // slice does to the other representation, so the risk is legible rather
    // than implied.
    const asDate = String(new Date('2026-08-01T00:00:00Z')).slice(0, 7);
    expect(asDate).not.toBe('2026-08');
  });
});

// ─── The stale-template refusal ─────────────────────────────────────────────
//
// rerenderFarming renders the STORED figures through TODAY'S document. A
// layout change between the two means a field the new document reads may not
// be in the stored object — and because these are jsonb, it arrives as
// undefined and prints as a blank rather than failing.
//
// Concierge already relies on the version stamp for exactly this: profile #3
// stays on v1 with its original PDF while #4 is on v2. Farming stored the same
// column and never read it. Now it refuses, and the report can be created
// again from its stored dataset, which produces figures that match the current
// document by construction.
describe('a farming report is not re-rendered onto a different template', () => {
  const src = readFileSync(join(__dirname, 'generate.ts'), 'utf8').replace(/\r\n/g, '\n');
  const fn = src.slice(src.indexOf('export async function rerenderFarming'));

  it('compares the row template against the current one', () => {
    expect(fn).toContain('row.templateVersion !== currentTemplate');
  });

  it('refuses rather than rendering anyway', () => {
    expect(fn).toMatch(/reason:\s*'stale_template'/);
  });

  it('checks BEFORE the figures are read, so a mismatch cannot render', () => {
    const check = fn.indexOf('stale_template');
    const firstFigureRead = fn.indexOf('salesActivityFigures(');
    expect(check).toBeGreaterThan(-1);
    expect(firstFigureRead).toBeGreaterThan(-1);
    expect(check).toBeLessThan(firstFigureRead);
  });

  it('names a template for every type, so no type is silently exempt', () => {
    for (const t of ['sales_activity', 'carrier_route', 'county_sales']) {
      expect(TEMPLATE_FOR[t as keyof typeof TEMPLATE_FOR], `${t} has no current template`).toBeTruthy();
    }
  });

  it('reads the stored figures through a check rather than a cast', () => {
    // `as never` on a jsonb read is the mechanism that hid the concierge comp
    // mapping dropping five fields: nothing asks, so a missing value prints as
    // a blank. See stored-figures.ts.
    expect(fn).not.toMatch(/\br\.(metrics|months|routes|standouts|cities)\s+as never/);
  });
});
