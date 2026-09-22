import { describe, expect, it, vi, beforeEach } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

// ─── The generator, driven from a file, proven against the page ─────────────
//
// No screen reaches the generator yet. Each test here feeds it CSV text in the
// exact headers of Appendix A of the farming guide, lets it compute, render and
// store, then READS THE STORED PDF BACK and checks the numbers on it against
// figures worked out by hand in the comments.
//
// When a real legacy extract turns up, it belongs here as a fixture: synthetic
// rows prove the code runs; a real file proves it handles what the data
// actually looks like.

const state = vi.hoisted(() => ({
  inserts: [] as Array<{ table: unknown; values: Record<string, unknown> }>,
  updates: [] as Array<{ table: unknown; set: Record<string, unknown> }>,
  uploads: [] as Array<{ key: string; buffer: Buffer; contentType: string }>,
  failUploadsMatching: null as RegExp | null,
  nextId: 50,
}));

vi.mock('@/lib/db/client', () => ({
  db: {
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => ({
        returning: async () => { state.inserts.push({ table, values }); return [{ id: state.nextId }]; },
      }),
    }),
    update: (table: unknown) => ({
      set: (set: Record<string, unknown>) => ({ where: async () => { state.updates.push({ table, set }); } }),
    }),
  },
}));

vi.mock('@/lib/integrations/s3/client', () => ({
  uploadFile: vi.fn(async (p: { key: string; buffer: Buffer; contentType: string }) => {
    if (state.failUploadsMatching?.test(p.key)) return { success: false };
    state.uploads.push(p);
    return { success: true };
  }),
}));

vi.mock('@/lib/domain/concierge/presenting-rep', () => ({
  resolvePresentingRep: vi.fn(async (_order: unknown, contactId: number) => (contactId === 22140
    ? { ok: true, source: 'override', rep: { name: 'Mark Neveu', title: 'Sales Representative', phone: '(714) 555-0142', email: 'mneveu@pct.com' } }
    : { ok: false, reason: 'contact_missing', message: 'That representative could not be found.' })),
}));

const { generateSalesActivity, generateCarrierRoute, generateCountySales } = await import('./generate');
const { salesActivityReports, carrierRouteReports, countySalesReports } = await import('@/lib/db/schema');

const NOW = new Date('2026-09-21T17:00:00Z');
const base = { brandedToContactId: 22140, createdBy: 'ops@pct.com', now: NOW };

beforeEach(() => {
  state.inserts.length = 0;
  state.updates.length = 0;
  state.uploads.length = 0;
  state.failUploadsMatching = null;
});

/** Text of the PDF the generator STORED, squashed of whitespace. */
async function storedPdfText(): Promise<{ text: string; pages: number }> {
  const pdf = state.uploads.find((u) => u.contentType === 'application/pdf');
  if (!pdf) throw new Error('no PDF was stored');
  const doc = await getDocument({ data: new Uint8Array(pdf.buffer), verbosity: 0 }).promise;
  const parts: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const c = await (await doc.getPage(p)).getTextContent();
    parts.push(c.items.map((i) => ('str' in i ? i.str : '')).join(' '));
  }
  return { text: parts.join(' ').replace(/\s+/g, ''), pages: doc.numPages };
}
const sq = (s: string) => s.replace(/\s+/g, '');

// ─── 01 · Sales Activity ────────────────────────────────────────────────────

// Appendix A headers, exactly. A 3-month window ending August 2026: June–August.
const SALES_CSV = [
  'APN / Parcel Number,Bedrooms,Baths,Building Size,Owner Occupied,Purchase Price,Purchase Date',
  '123-456-001,3,2,1600,Y,1200000,2026-08-04',   // $750.00 / sq ft
  '123-456-002,2,2,1200,n,980000,2026-08-19',    // $816.67
  '123-456-003,3,2.5,1450,Y,1150000,2026-08-27', // $793.10
  '123-456-004,3,2,1250,Y,1000000,2026-07-09',   // $800.00
  '123-456-005,2,2,1200,N,900000,2026-07-22',    // $750.00
  '123-456-006,2,1,1000,Y,760000,2026-06-15',    // $760.00
  '123-456-007,4,3,2400,Y,5000000,2025-08-15',   // August, but LAST year: outside
  '123-456-008,3,2,1500,Y,,2026-08-01',          // no price
  '123-456-009,3,2,1500,Y,850000,not a date',    // no date
].join('\n');

describe('Sales Activity, file to page', () => {
  const run = () => generateSalesActivity({
    ...base, csv: SALES_CSV, areaName: 'Santa Monica', propertyType: 'Single family', windowMonths: 3, windowEnd: '2026-08',
  });

  it('succeeds and stores one PDF', async () => {
    const r = await run();
    expect(r).toMatchObject({ ok: true, reportId: 50, pageCount: 1 });
  });

  it('prints the headline figures worked out by hand', async () => {
    await run();
    const { text } = await storedPdfText();
    // Six sales in June–August. Prices sorted: 760, 900, 980, 1000, 1150, 1200 (k)
    // → median (980 + 1000) / 2 = $990,000.
    expect(text).toContain(sq('HOMES SOLD 6'));
    expect(text).toContain(sq('MEDIAN SALE PRICE $990,000'));
    // Own rates sorted: 750, 750, 760, 793.10, 800, 816.67 → (760 + 793.10) / 2 = $776.55.
    expect(text).toContain(sq('MEDIAN $ / SQ FT $777'));
    // Beds 2,2,2,3,3,3 → 2.5. Baths 1,2,2,2,2,2.5 → 2.
    expect(text).toContain(sq('TYPICAL BEDROOMS 2.5'));
    expect(text).toContain(sq('TYPICAL BATHROOMS 2'));
    // Two of six are "n"/"N" → 33%.
    expect(text).toContain(sq('OWNED BY NON-OCCUPANTS 33%'));
  });

  it('prints the months, newest first, with change against the month before', async () => {
    await run();
    const { text } = await storedPdfText();
    // August: median of 750, 816.67, 793.10 = $793.10. July: (800 + 750) / 2 = $775.
    // June: $760. Aug vs Jul: (793.10 − 775) / 775 = +2.3%. Jul vs Jun: +2.0%.
    expect(text).toContain(sq('August 2026 3 $1,150,000 $793 +2.3%'));
    expect(text).toContain(sq('July 2026 2 $950,000 $775 +2.0%'));
    expect(text).toContain(sq('June 2026 1 $760,000 $760 —'));
  });

  it('leaves out last August, however the month number matches', async () => {
    await run();
    const { text } = await storedPdfText();
    expect(text).toContain(sq('1 sale in the file fell outside this window'));
    expect(text).not.toContain('$5,000,000');
  });

  it('counts the rows it could not use, on the page and on the row', async () => {
    await run();
    const { text } = await storedPdfText();
    expect(text).toContain(sq('9 rows read · 7 used · 2 could not be used'));
    expect(state.inserts[0]!.values).toMatchObject({ datasetRows: 9, datasetUsed: 7, datasetRejected: 2 });
  });

  it('writes the row with its Subject and Settings, and the window as a date range', async () => {
    await run();
    const ins = state.inserts[0]!;
    expect(ins.table).toBe(salesActivityReports);
    expect(ins.values).toMatchObject({
      listSubject: 'Santa Monica', listSubjectDetail: 'Single family', listSettings: '3 months to August 2026',
      windowStart: '2026-06-01', windowEnd: '2026-08-31', status: 'pending', brandedToName: 'Mark Neveu',
    });
  });
});

// ─── The order of operations, and every refusal ─────────────────────────────

describe('the generator\'s order of operations', () => {
  const ok = () => generateSalesActivity({
    ...base, csv: SALES_CSV, areaName: 'Santa Monica', propertyType: null, windowMonths: 3, windowEnd: '2026-08',
  });

  it('stores the source file before the PDF', async () => {
    await ok();
    expect(state.uploads.map((u) => u.contentType)).toEqual(['text/csv', 'application/pdf']);
    expect(state.uploads[0]!.key).toBe('reports/sales_activity/50/dataset.csv');
    expect(state.uploads[1]!.key).toMatch(/^reports\/sales_activity\/50\/report-2026-09-21T17-00-00-000Z\.pdf$/);
  });

  it('marks the row generated only once the PDF is stored', async () => {
    await ok();
    const last = state.updates[state.updates.length - 1]!.set;
    expect(last).toMatchObject({ status: 'generated', pdfPageCount: 1 });
    expect(last.pdfStorageKey).toMatch(/\.pdf$/);
  });

  it('marks the row FAILED, with the reason, when the source file cannot be kept — and renders nothing', async () => {
    state.failUploadsMatching = /dataset\.csv$/;
    const r = await ok();
    expect(r).toMatchObject({ ok: false, reportId: 50, stage: 'dataset' });
    expect(state.updates.at(-1)!.set).toMatchObject({ status: 'failed' });
    expect(state.uploads.some((u) => u.contentType === 'application/pdf')).toBe(false);
  });

  it('marks the row failed when the PDF cannot be stored', async () => {
    state.failUploadsMatching = /\.pdf$/;
    const r = await ok();
    expect(r).toMatchObject({ ok: false, reportId: 50, stage: 'store' });
    expect(state.updates.at(-1)!.set).toMatchObject({ status: 'failed' });
  });

  it('refuses a file missing a required column, naming it, and writes NO row', async () => {
    const r = await generateSalesActivity({
      ...base, csv: 'Bedrooms,Purchase Date\n3,2026-08-01', areaName: 'X', propertyType: null, windowMonths: 3, windowEnd: '2026-08',
    });
    expect(r).toMatchObject({ ok: false, reportId: null, stage: 'parse' });
    expect((r as { message: string }).message).toContain('purchase price');
    expect(state.inserts).toHaveLength(0);
  });

  it('refuses a file with nothing usable in it, saying why, and writes NO row', async () => {
    const r = await generateSalesActivity({
      ...base, csv: 'Purchase Price,Purchase Date\n,2026-08-01\n,2026-08-02', areaName: 'X', propertyType: null, windowMonths: 3, windowEnd: '2026-08',
    });
    expect((r as { message: string }).message).toContain('None of the 2 rows could be used: (no price) (2)');
    expect(state.inserts).toHaveLength(0);
  });

  it('refuses a window other than 3, 6 or 12 months', async () => {
    const r = await generateSalesActivity({
      ...base, csv: SALES_CSV, areaName: 'X', propertyType: null, windowMonths: 4 as never, windowEnd: '2026-08',
    });
    expect(r).toMatchObject({ ok: false, stage: 'input' });
  });

  it('resolves the rep from the contact, and refuses one that cannot be found', async () => {
    const r = await generateSalesActivity({
      ...base, brandedToContactId: 999, csv: SALES_CSV, areaName: 'X', propertyType: null, windowMonths: 3, windowEnd: '2026-08',
    });
    expect(r).toMatchObject({ ok: false, reportId: null, stage: 'input', message: 'That representative could not be found.' });
    expect(state.inserts).toHaveLength(0);
  });
});

// ─── 02 · Carrier Route Analysis ────────────────────────────────────────────

const ROUTE_CSV = [
  'carrier_route,avg_price,turnover_rate,total_sales,NOO_ratio,avg_yr_owned,total_units,sa_site_zip,sa_site_city',
  '904031C001,1840000,8.4,19,41,11.2,420,90403,Santa Monica',
  '904032C004,1625000,6.1,11,28,14.0,310,90403,Santa Monica',
  '904053C011,2210000,5.0,8,55,17.6,280,90405,Santa Monica',
  ',1000000,9.9,5,10,5.0,100,90405,Santa Monica',               // no route id: rejected
].join('\n');

describe('Carrier Route Analysis, file to page', () => {
  const run = () => generateCarrierRoute({ ...base, csv: ROUTE_CSV, areaName: 'Santa Monica', rankBy: 'turnover' });

  it('hyphenates route ids after the ZIP, as legacy did', async () => {
    await run();
    const { text } = await storedPdfText();
    // 904031C001 with ZIP 90403 → 90403-1C001 (Appendix A's own example).
    expect(text).toContain('90403-1C001');
    expect(text).toContain('90405-3C011');
  });

  it('names under each standout the route that won that measure', async () => {
    await run();
    const { text } = await storedPdfText();
    expect(text).toContain(sq('FASTEST TURNOVER 8.4% Route 90403-1C001'));
    expect(text).toContain(sq('MOST NON-OWNER OCCUPIED 55.0% Route 90405-3C011'));
    expect(text).toContain(sq('LONGEST AVERAGE HOLD 17.6 yrs Route 90405-3C011'));
    expect(text).toContain(sq('LARGEST MAIL DROP 420 units Route 90403-1C001'));
  });

  it('ranks by the chosen measure', async () => {
    await run();
    const { text } = await storedPdfText();
    expect(text.indexOf('190403-1C001')).toBeLessThan(text.indexOf('290403-2C004'));
    expect(text.indexOf('290403-2C004')).toBeLessThan(text.indexOf('390405-3C011'));
  });

  it('writes Subject and Settings the list prints', async () => {
    await run();
    expect(state.inserts[0]!.table).toBe(carrierRouteReports);
    expect(state.inserts[0]!.values).toMatchObject({
      listSubject: 'Santa Monica', listSubjectDetail: '3 routes', listSettings: 'Top 3 by turnover',
      datasetRejected: 1, rejectedTypes: { '(blank route id)': 1 },
    });
  });
});

// ─── 03 · County Sales ──────────────────────────────────────────────────────

const COUNTY_CSV = [
  'Site City,Purchase Price,Property Type',
  'Irvine,1100000,rsfr',
  'Irvine,1250000,rsfr',
  'IRVINE,2400000,RSFR',          // same city, shouting — and skewed, so a mean would show
  'Irvine,720000,rcon',
  'Irvine,780000,Condo',          // legacy dropped this in silence
  'Newport Beach,2100000,SFR',    // and this
  'Tustin,900000,Single Family',
  'Irvine,1900000,RNEW',          // unrecognised: counted, not dropped
  'Anaheim,650000,Mineral Rights',
].join('\n');

describe('County Sales, file to page', () => {
  const run = () => generateCountySales({ ...base, csv: COUNTY_CSV, county: 'Orange', month: '2026-08' });

  it('prints each city with true medians, houses and condominiums apart', async () => {
    await run();
    const { text } = await storedPdfText();
    // Irvine houses 1.10 / 1.25 / 2.40M → median $1,250,000 (the mean, which
    // legacy printed under this label, would be $1,583,333). Condos → $750,000.
    expect(text).toContain(sq('Irvine 3 $1,250,000 2 $750,000'));
    expect(text).toContain(sq('Newport Beach 1 $2,100,000 — —'));
    expect(text).toContain(sq('Tustin 1 $900,000 — —'));
  });

  it('computes the county total from the sales, not the city medians', async () => {
    await run();
    const { text } = await storedPdfText();
    // Houses 0.90, 1.10, 1.25, 2.10, 2.40M → $1,250,000. Condos → $750,000.
    expect(text).toContain(sq('Orange County total 5 $1,250,000 2 $750,000'));
  });

  it('counts what it could not classify, by the value that caused it', async () => {
    await run();
    const { text } = await storedPdfText();
    expect(text).toContain(sq('9 rows read · 7 used · 2 could not be used'));
    expect(text).toContain('MineralRights(1)');
    expect(text).toContain('RNEW(1)');
    expect(state.inserts[0]!.values).toMatchObject({ rejectedTypes: { RNEW: 1, 'Mineral Rights': 1 } });
  });

  it('writes the month as a date and the list columns', async () => {
    await run();
    expect(state.inserts[0]!.table).toBe(countySalesReports);
    expect(state.inserts[0]!.values).toMatchObject({
      month: '2026-08-01', listSubject: 'Orange County', listSubjectDetail: '3 cities', listSettings: 'August 2026',
    });
  });

  it('reads a CSV as Excel saves it: byte-order mark first, Windows line endings', async () => {
    // "Save As CSV (UTF-8)" writes U+FEFF before the first header. A parser that
    // kept it would see "<BOM>Site City", find no city column, and refuse the
    // first real file anyone uploaded.
    const excel = '﻿' + COUNTY_CSV.replace(/\n/g, '\r\n');
    const r = await generateCountySales({ ...base, csv: excel, county: 'Orange', month: '2026-08' });
    expect(r).toMatchObject({ ok: true });
    const { text } = await storedPdfText();
    expect(text).toContain(sq('Orange County total 5 $1,250,000 2 $750,000'));
  });

  it('refuses a county outside the six', async () => {
    const r = await generateCountySales({ ...base, csv: COUNTY_CSV, county: 'Kern' as never, month: '2026-08' });
    expect(r).toMatchObject({ ok: false, stage: 'input' });
    expect(state.inserts).toHaveLength(0);
  });
});
