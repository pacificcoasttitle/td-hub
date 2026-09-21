import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToBuffer } from '@react-pdf/renderer';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { computeCarrierRoute, computeCountySales, computeSalesActivity } from '../compute';
import { monthWindow, type AreaSaleRow, type CountySaleRow, type RouteRow } from '../datasets';
import { AREA_MEDIAN_NOTE, COUNTY_MEDIAN_NOTE, ROUTE_AVERAGE_NOTE, ROUTE_STANDOUT_NOTE } from '../definitions';
import { SalesActivityDocument, changeText } from './sales-activity-document';
import { CarrierRouteDocument, oneDecimal } from './carrier-route-document';
import { CountySalesDocument } from './county-sales-document';
import { CUSTOMER_SERVICE, OPEN_ORDERS, type RepBlock } from './family';

// ─── The documents, read the way an agent reads them ────────────────────────
//
// Each test renders the REAL PDF and reads its text back with pdf.js. The first render of
// Sales Activity printed three monthly declines as "3.2%", "3.9%", "4.8%" —
// the typographic minus is not in Helvetica's encoding and react-pdf dropped it
// without a word. Nothing short of reading the output would have caught that.

type Parsed = { text: string; numpages: number };
const has = (text: string, needle: string) => text.includes(flat(needle));

/**
 * Text as a reader gets it, page by page, from the modern pdf.js.
 *
 * NOT pdf-parse: it bundles pdf.js 1.10 (2017), which reads these files on
 * Windows and rejects the same output on Linux with "bad XRef entry". The
 * parser was the fault, not the PDF — the current pdf.js reads them on both.
 */
const read = async (el: React.ReactElement): Promise<Parsed> => {
  const buf = await renderToBuffer(el as never);
  const doc = await getDocument({ data: new Uint8Array(buf), verbosity: 0 }).promise;
  const pages: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent();
    pages.push(content.items.map((i) => ('str' in i ? i.str : '')).join(' '));
  }
  return { text: pages.join('\n'), numpages: doc.numPages };
};

/**
 * Whitespace removed. Letter-spaced labels can come back one glyph at a time —
 * "S A L E S" — so comparisons are made with spacing squashed out on both
 * sides. What is being checked is the characters and their order.
 */
const flat = (s: string) => s.replace(/\s+/g, '');

const rep: RepBlock = { name: 'Mark Neveu', title: 'Sales Representative', phone: '(714) 555-0142', email: 'mneveu@pct.com', photo: null };
const at = new Date(Date.UTC(2026, 8, 21));
const clean = { rowsRead: 10, used: 10, rejected: 0, rejectedTypes: {} };

const sale = (iso: string, price: number, area = 1000, ownerOccupied: boolean | null = true): AreaSaleRow =>
  ({ apn: null, price, saleDate: new Date(iso + 'T12:00:00Z'), buildingArea: area, beds: 3, baths: 2, ownerOccupied });

describe('Sales Activity', () => {
  // $/sq ft falls from 1,000 in June to 900 in July: a 10% decline.
  const figures = computeSalesActivity([
    sale('2026-06-10', 1_000_000), sale('2026-07-10', 900_000), sale('2026-08-10', 945_000, 1000, null),
  ], monthWindow(new Date(Date.UTC(2026, 7, 1)), 3));
  const doc = () => read(SalesActivityDocument({
    areaName: 'Santa Monica', propertyType: 'Single family', windowMonths: 3, windowEndKey: '2026-08',
    figures, quality: clean, rep, generatedAt: at,
  }));

  it('prints a decline WITH its sign', async () => {
    expect(has(flat((await doc()).text), '-10.0%')).toBe(true);
  });

  it('never emits a minus Helvetica cannot draw', () => {
    expect(changeText(-3.24)).toBe('-3.2%');
    expect(changeText(-3.24)).not.toContain('−');
    expect(changeText(null)).toBe('—');
  });

  it('says median, and says what median means here', async () => {
    const text = flat((await doc()).text);
    expect(has(text, 'MEDIAN SALE PRICE')).toBe(true);
    expect(has(text, AREA_MEDIAN_NOTE)).toBe(true);
    expect(text).not.toMatch(/AVG\.?SALESPRICE|AVERAGE/i);
  });

  it('says the property type is a caption, because the file cannot filter by it', async () => {
    expect(has(flat((await doc()).text), 'The sales file carries no property type')).toBe(true);
  });

  it('says what the non-occupant share is OF when some sales did not record it', async () => {
    expect(has(flat((await doc()).text), 'of the 2 sales that record occupancy')).toBe(true);
  });

  it('renders an empty window as an absence with its reason, never as zeros', async () => {
    const empty = computeSalesActivity([sale('2024-01-10', 1)], monthWindow(new Date(Date.UTC(2026, 7, 1)), 3));
    const text = flat((await read(SalesActivityDocument({
      areaName: 'Santa Monica', propertyType: null, windowMonths: 3, windowEndKey: '2026-08',
      figures: empty, quality: { rowsRead: 1, used: 1, rejected: 0, rejectedTypes: {} }, rep, generatedAt: at,
    }))).text);
    expect(has(text, 'Sales in this window not available')).toBe(true);
    expect(has(text, '1 sale in the file fell outside this window')).toBe(true);
    expect(has(text, 'HOMES SOLD')).toBe(false);
  });

  it('is one page', async () => {
    expect((await doc()).numpages).toBe(1);
  });
});

const route = (routeId: string, over: Partial<RouteRow> = {}): RouteRow => ({
  routeId, zip: '90403', city: 'Santa Monica', totalUnits: 300, totalSales: 10,
  avgPrice: 1_500_000, turnoverRate: 5, nonOwnerRatio: 20, avgYearsOwned: 12, ...over,
});

describe('Carrier Route Analysis', () => {
  const figures = computeCarrierRoute([
    route('90403-C001', { turnoverRate: 9, nonOwnerRatio: 10 }),
    route('90403-C002', { turnoverRate: 7, nonOwnerRatio: 55 }),
    route('90403-C003', { turnoverRate: 3, avgYearsOwned: 19.4 }),
  ], 'turnover');
  const doc = () => read(CarrierRouteDocument({ areaName: 'Santa Monica', rankBy: 'turnover', figures, quality: clean, rep, generatedAt: at }));

  it('names, under each standout, the route that won THAT measure', async () => {
    // Legacy printed the turnover winner under the non-owner figure.
    const text = flat((await doc()).text);
    expect(text).toMatch(/FASTESTTURNOVER9\.0%Route90403-C001/);
    expect(text).toMatch(/MOSTNON-OWNEROCCUPIED55\.0%Route90403-C002/);
    expect(text).toMatch(/LONGESTAVERAGEHOLD19\.4yrsRoute90403-C003/);
  });

  it('calls route prices averages, because the feed only has averages', async () => {
    const text = flat((await doc()).text);
    expect(has(text, 'AVG PRICE')).toBe(true);
    expect(has(text, ROUTE_AVERAGE_NOTE)).toBe(true);
    expect(text).not.toMatch(/MEDIAN/);
  });

  it('says the standouts are the best of the routes shown', async () => {
    expect(has(flat((await doc()).text), ROUTE_STANDOUT_NOTE)).toBe(true);
  });

  it('keeps one decimal down a column of rates, so 7.0% does not read as a different kind of number', async () => {
    expect(oneDecimal(7, '%')).toBe('7.0%');
    expect(has(flat((await doc()).text), '7.0%')).toBe(true);
  });

  it('carries the three one-line definitions an agent needs', async () => {
    const text = flat((await doc()).text);
    for (const term of ['Turnover.', 'Non-owner.', 'Units.']) expect(has(text, term)).toBe(true);
  });
});

describe('County Sales', () => {
  const cityRows = (n: number): CountySaleRow[] => Array.from({ length: n }, (_, i) => ({
    city: `City ${String(i).padStart(2, '0')}`, price: 800_000 + i * 1000, propertyKind: 'single_family' as const,
  }));
  const render = (rows: CountySaleRow[]) => read(CountySalesDocument({
    county: 'Orange', monthKey: '2026-08', figures: computeCountySales(rows),
    quality: { rowsRead: rows.length, used: rows.length, rejected: 0, rejectedTypes: {} }, rep, generatedAt: at,
  }));

  it('runs 22 cities to a page and states its own length', async () => {
    const out = await render(cityRows(44));
    expect(out.numpages).toBe(2);
    expect(has(flat(out.text), 'Page 1 of 2')).toBe(true);
    expect(has(flat(out.text), 'Page 2 of 2')).toBe(true);
  });

  it('prints the county total once, on the last page', async () => {
    const text = flat((await render(cityRows(30))).text);
    expect(text.match(/OrangeCountytotal/g)).toHaveLength(1);
    expect(text.indexOf('OrangeCountytotal')).toBeGreaterThan(text.indexOf('Page1of2'));
  });

  it('prints an em dash, not a zero, for a city with no condominium sales', async () => {
    const text = flat((await render([{ city: 'Tustin', price: 900_000, propertyKind: 'single_family' }])).text);
    expect(text).toMatch(/Tustin1\$900,000——/);
  });

  it('says median and means it', async () => {
    expect(has(flat((await render(cityRows(3))).text), COUNTY_MEDIAN_NOTE)).toBe(true);
  });

  it('counts the sales it has no column for, out loud', async () => {
    const text = flat((await render([
      { city: 'Irvine', price: 1, propertyKind: 'single_family' },
      { city: 'Irvine', price: 2, propertyKind: 'land' },
    ])).text);
    expect(has(text, '1 sale of other property types (land 1)')).toBe(true);
  });
});

describe('the family', () => {
  it('puts the rep and the same two contact lines on EVERY page', async () => {
    const out = await read(CountySalesDocument({
      county: 'Orange', monthKey: '2026-08',
      figures: computeCountySales(Array.from({ length: 30 }, (_, i) => ({ city: `C${i}`, price: 1, propertyKind: 'single_family' as const }))),
      quality: clean, rep, generatedAt: at,
    }));
    const text = flat(out.text);
    expect(text.split(flat('Mark Neveu')).length - 1).toBe(2);
    expect(text.split(flat(CUSTOMER_SERVICE)).length - 1).toBe(2);
    expect(text.split(flat(OPEN_ORDERS)).length - 1).toBe(2);
  });

  it('renders the block without a photo rather than with a placeholder', async () => {
    const text = flat((await read(SalesActivityDocument({
      areaName: 'X', propertyType: null, windowMonths: 3, windowEndKey: '2026-08',
      figures: computeSalesActivity([sale('2026-08-01', 1)], monthWindow(new Date(Date.UTC(2026, 7, 1)), 3)),
      quality: clean, rep: { ...rep, photo: null }, generatedAt: at,
    }))).text);
    expect(has(text, 'Mark Neveu')).toBe(true);
  });
});

// ─── Characters Helvetica can draw ──────────────────────────────────────────
//
// react-pdf's standard fonts use WinAnsi. A character outside it is DROPPED,
// silently — that is how the minus vanished, and how a ▼ marking the ranked
// column would have vanished too. Every non-ASCII character in the strings these
// documents print must be one WinAnsi can encode.

const WIN_ANSI_EXTRAS = new Set(Array.from('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'));
const encodable = (ch: string) => {
  const c = ch.codePointAt(0)!;
  return c < 0x80 || (c >= 0xa0 && c <= 0xff) || WIN_ANSI_EXTRAS.has(ch);
};

describe('every printed string is one Helvetica can draw', () => {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const files = [
    ...readdirSync(HERE).filter((n) => n.endsWith('.tsx') && !n.includes('.test.')).map((n) => join(HERE, n)),
    join(HERE, '..', 'definitions.ts'),
    join(HERE, '..', 'compute.ts'),
  ];

  it.each(files.map((p) => [p.split(/[\\/]/).pop()!, p]))('%s', (_name, path) => {
    // Comments are not printed, and they are where these glyphs get discussed.
    const code = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const bad = [...new Set(Array.from(code).filter((ch) => !encodable(ch)))];
    expect(bad, `characters react-pdf would silently drop: ${bad.map((c) => `U+${c.codePointAt(0)!.toString(16).toUpperCase()}`).join(' ')}`)
      .toEqual([]);
  });

  it('catches the two that already bit', () => {
    expect(encodable('−')).toBe(false);   // the minus
    expect(encodable('▼')).toBe(false);   // the ranking arrow
    expect(encodable('—')).toBe(true);          // GAP
    expect(encodable('·')).toBe(true);          // the separator
  });
});
