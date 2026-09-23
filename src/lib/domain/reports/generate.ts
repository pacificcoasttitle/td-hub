/**
 * The farming report generator: a file in, a stored report out.
 *
 * ─── ORDER OF OPERATIONS ────────────────────────────────────────────────────
 *
 *   1. parse      refuse — with NO row — a file missing the columns the report
 *                 needs, or one with nothing readable in it at all
 *   2. row        status 'pending', so a crash leaves a record, not a gap
 *   3. dataset    the uploaded file to storage BEFORE anything is computed from
 *                 it; a report we cannot reproduce is not produced
 *   4. figures    computed once and STORED, with Subject and Settings, so the
 *                 list and any later render read the same numbers back
 *   5. render     the document, from those figures
 *   6. pdf        to storage, keyed per render; the row is 'generated' only
 *                 once the file is there
 *
 * Any failure after step 2 marks the row 'failed' with the reason and returns
 * it — never a throw, never a row that says 'pending' forever.
 *
 * ─── THE REP IS RESOLVED HERE, NOT ACCEPTED ─────────────────────────────────
 *
 * The caller names a CONTACT. The name, title, phone and email printed on the
 * leave-behind are read from that contact server-side and snapshotted onto the
 * row, the same rule as the concierge presenting rep: a client-facing document
 * does not print details a browser supplied.
 *
 * ─── DRIVEN FROM A TEST, BEFORE ANY SCREEN ──────────────────────────────────
 *
 * No UI reaches this yet. generate.test.ts pushes real CSV text through it and
 * reads the rendered PDF back, so the numbers are proven against the document
 * before the modal exists.
 */
import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { renderToBuffer } from '@react-pdf/renderer';
import { db } from '@/lib/db/client';
import { carrierRouteReports, countySalesReports, salesActivityReports } from '@/lib/db/schema';
import { uploadFile } from '@/lib/integrations/s3/client';
import { resolvePresentingRep } from '@/lib/domain/concierge/presenting-rep';
import { repVisibility } from './rep-visibility';
import {
  CITIES_PER_PAGE, RANK_BY, RANK_LABEL, computeCarrierRoute, computeCountySales, computeSalesActivity, monthLabel,
  type DataQuality, type RankBy,
} from './compute';
import { carrierRouteFigures, countySalesFigures, salesActivityFigures } from './stored-figures';
import {
  monthWindow, parseAreaSaleRows, parseCountySaleRows, parseRouteRows, type ParseReport,
} from './datasets';
import {
  SalesActivityDocument, TEMPLATE_VERSION as SA_TEMPLATE,
} from './document/sales-activity-document';
import {
  CarrierRouteDocument, TEMPLATE_VERSION as CR_TEMPLATE,
} from './document/carrier-route-document';
import {
  CountySalesDocument, TEMPLATE_VERSION as CS_TEMPLATE,
} from './document/county-sales-document';
import type { RepBlock } from './document/family';

// ─── Inputs and outcomes ────────────────────────────────────────────────────

// The option lists live in options.ts so the browser can import them without
// reaching this module, which reaches the database.
import { FARMING_COUNTIES, FARMING_WINDOWS, type FarmingCounty, type FarmingWindow } from './options';
export { FARMING_COUNTIES, FARMING_WINDOWS, type FarmingCounty, type FarmingWindow };

interface Common {
  /** The uploaded file, as text. */
  csv: string;
  /** Which contact the report is branded to. Resolved here, never trusted. */
  brandedToContactId: number;
  createdBy: string;
  now?: Date;
}

export interface SalesActivityRequest extends Common {
  areaName: string;
  propertyType: string | null;
  windowMonths: FarmingWindow;
  /** `YYYY-MM`, the last month in the window. */
  windowEnd: string;
}

export interface CarrierRouteRequest extends Common {
  areaName: string;
  rankBy: RankBy;
}

export interface CountySalesRequest extends Common {
  county: FarmingCounty;
  /** `YYYY-MM`, the month the file covers. */
  month: string;
}

export type GenerateOutcome =
  /**
   * `repWarning` is set when the report cannot reach the rep it is branded to
   * — they have no login, or their login points at a different contact row of
   * the same name. The report is still generated: it warns, it does not block
   * (src/lib/domain/reports/rep-visibility.ts).
   */
  | { ok: true; reportId: number; pdfStorageKey: string; pageCount: number; quality: DataQuality; repWarning?: string | null }
  /** Refused before anything was written. The message says what to fix. */
  | { ok: false; reportId: null; stage: 'input' | 'parse'; message: string }
  /** A row exists and says failed, with this reason on it. */
  | { ok: false; reportId: number; stage: 'dataset' | 'render' | 'store'; message: string };

// ─── Shared steps ───────────────────────────────────────────────────────────

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

function quality(p: ParseReport<unknown>): DataQuality {
  return { rowsRead: p.total, used: p.used, rejected: p.rejected, rejectedTypes: p.rejectedTypes };
}

/**
 * Refuse a file that cannot make this report, before a row exists.
 *
 * Missing columns name the fields in the words the report uses. A file with
 * columns but nothing readable says what was wrong with the rows — counted,
 * the way the page would have counted them.
 */
function parseProblem(p: ParseReport<unknown>, fieldWords: Record<string, string>): string | null {
  if (p.missingFields.length > 0) {
    const names = p.missingFields.map((f) => fieldWords[f] ?? f).join(', ');
    return `The file has no column for: ${names}.`
      + (p.unmappedHeaders.length ? ` Columns it does have that were not recognised: ${p.unmappedHeaders.join(', ')}.` : '');
  }
  if (p.total === 0) return 'The file has a header row and no data.';
  if (p.used === 0) {
    const why = Object.entries(p.rejectedTypes).map(([k, n]) => `${k} (${n})`).join(', ');
    return `None of the ${p.total} rows could be used: ${why}.`;
  }
  return null;
}

async function loadRep(contactId: number): Promise<{ ok: true; rep: RepBlock; warning: string | null } | { ok: false; message: string }> {
  const r = await resolvePresentingRep(null, contactId);
  if (!r.ok) return { ok: false, message: r.message };
  // Checked BEFORE the row is written: a report branded to a contact no login
  // points at is one its rep can never see in their own list.
  const seen = await repVisibility(contactId);
  // No photo source exists yet. The block renders without one — never a
  // placeholder — until reps have photos stored somewhere we own.
  return { ok: true, rep: { name: r.rep.name, title: r.rep.title, phone: r.rep.phone, email: r.rep.email, photo: null }, warning: seen.warning };
}

const repColumns = (contactId: number, rep: RepBlock) => ({
  brandedToContactId: contactId,
  brandedToName: rep.name,
  brandedToTitle: rep.title,
  brandedToEmail: rep.email,
  brandedToPhone: rep.phone,
  brandedToPhotoKey: null,
});

const datasetKey = (type: string, id: number) => `reports/${type}/${id}/dataset.csv`;
const pdfKey = (type: string, id: number, at: Date) =>
  `reports/${type}/${id}/report-${at.toISOString().replace(/[:.]/g, '-')}.pdf`;

/** The same count the concierge render uses. */
const countPages = (buf: Buffer) => (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;

type Table = typeof salesActivityReports | typeof carrierRouteReports | typeof countySalesReports;

/**
 * Steps 3, 5 and 6 — shared by all three. The caller has already inserted the
 * row and written its figures; this stores the file, renders and stores the PDF.
 */
async function storeAndRender(args: {
  type: string;
  table: Table;
  id: number;
  csv: string;
  now: Date;
  render: () => Promise<Buffer>;
  quality: DataQuality;
  /** Carried from loadRep, so a success can still say who will never see it. */
  repWarning?: string | null;
}): Promise<GenerateOutcome> {
  const { type, table, id, now } = args;
  const fail = async (stage: 'dataset' | 'render' | 'store', message: string): Promise<GenerateOutcome> => {
    await db.update(table).set({ status: 'failed', errorMessage: message }).where(eq(table.id, id));
    return { ok: false, reportId: id, stage, message };
  };

  // 3. The file first. A report whose source cannot be kept is not produced.
  const csvBuf = Buffer.from(args.csv, 'utf8');
  const dKey = datasetKey(type, id);
  const dUp = await uploadFile({ key: dKey, buffer: csvBuf, contentType: 'text/csv' });
  if (!dUp.success) {
    return fail('dataset', 'The uploaded file could not be stored, so the report cannot be reproduced. Not generating a document from data we cannot keep.');
  }
  await db.update(table).set({
    datasetStorageKey: dKey,
    datasetSha256: crypto.createHash('sha256').update(csvBuf).digest('hex'),
  }).where(eq(table.id, id));

  const out = await renderAndStore({ type, table, id, now, render: args.render, quality: args.quality });
  return out.ok ? { ...out, repWarning: args.repWarning ?? null } : out;
}

/**
 * Steps 5 and 6 — render, then store the PDF and mark the row generated. The
 * ONE place a farming PDF is made: the generator and "Try again" both come
 * through here.
 */
async function renderAndStore(args: {
  type: string;
  table: Table;
  id: number;
  now: Date;
  render: () => Promise<Buffer>;
  quality: DataQuality;
}): Promise<GenerateOutcome> {
  const { type, table, id, now } = args;
  const fail = async (stage: 'render' | 'store', message: string): Promise<GenerateOutcome> => {
    await db.update(table).set({ status: 'failed', errorMessage: message }).where(eq(table.id, id));
    return { ok: false, reportId: id, stage, message };
  };

  // 5. Render.
  let pdf: Buffer;
  try {
    pdf = await args.render();
  } catch (e) {
    return fail('render', `The document could not be rendered: ${(e as Error).message}`);
  }

  // 6. The PDF, keyed per render. Only now is the row 'generated'.
  const key = pdfKey(type, id, now);
  const up = await uploadFile({ key, buffer: pdf, contentType: 'application/pdf' });
  if (!up.success) return fail('store', 'The document rendered but could not be stored.');

  const pageCount = countPages(pdf);
  await db.update(table).set({
    pdfStorageKey: key,
    pdfSha256: crypto.createHash('sha256').update(pdf).digest('hex'),
    pdfBytes: pdf.length,
    pdfPageCount: pageCount,
    status: 'generated',
    errorMessage: null,
  }).where(eq(table.id, id));

  return { ok: true, reportId: id, pdfStorageKey: key, pageCount, quality: args.quality };
}

// ─── 01 · Sales Activity ────────────────────────────────────────────────────

export async function generateSalesActivity(req: SalesActivityRequest): Promise<GenerateOutcome> {
  const now = req.now ?? new Date();
  if (!req.areaName.trim()) return { ok: false, reportId: null, stage: 'input', message: 'Enter the area name.' };
  if (!FARMING_WINDOWS.includes(req.windowMonths)) {
    return { ok: false, reportId: null, stage: 'input', message: 'The window must be 3, 6 or 12 months.' };
  }
  if (!MONTH_KEY.test(req.windowEnd)) return { ok: false, reportId: null, stage: 'input', message: 'The window must end on a month.' };

  const parsed = parseAreaSaleRows(req.csv);
  const problem = parseProblem(parsed, { price: 'purchase price', saleDate: 'purchase date' });
  if (problem) return { ok: false, reportId: null, stage: 'parse', message: problem };

  const rep = await loadRep(req.brandedToContactId);
  if (!rep.ok) return { ok: false, reportId: null, stage: 'input', message: rep.message };

  const [y, m] = req.windowEnd.split('-').map(Number) as [number, number];
  const window = monthWindow(new Date(Date.UTC(y, m - 1, 1)), req.windowMonths);
  const figures = computeSalesActivity(parsed.rows, window);
  const q = quality(parsed);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  const [row] = await db.insert(salesActivityReports).values({
    areaName: req.areaName.trim(),
    propertyType: req.propertyType?.trim() || null,
    windowMonths: req.windowMonths,
    windowStart: iso(window.start),
    windowEnd: iso(window.end),
    ...repColumns(req.brandedToContactId, rep.rep),
    datasetSource: 'csv_upload',
    datasetRows: q.rowsRead,
    datasetUsed: q.used,
    datasetRejected: q.rejected,
    rejectedTypes: q.rejectedTypes,
    listSubject: req.areaName.trim(),
    listSubjectDetail: req.propertyType?.trim() || 'All property types',
    listSettings: `${req.windowMonths} months to ${monthLabel(req.windowEnd)}`,
    metrics: figures.metrics as unknown as Record<string, unknown>,
    months: figures.months as unknown as Record<string, unknown>,
    templateVersion: SA_TEMPLATE,
    status: 'pending',
    createdBy: req.createdBy,
  }).returning({ id: salesActivityReports.id });

  return storeAndRender({
    repWarning: rep.warning,
    type: 'sales_activity', table: salesActivityReports, id: row!.id, csv: req.csv, now, quality: q,
    render: () => renderToBuffer(SalesActivityDocument({
      areaName: req.areaName.trim(), propertyType: req.propertyType?.trim() || null,
      windowMonths: req.windowMonths, windowEndKey: req.windowEnd,
      figures, quality: q, rep: rep.rep, generatedAt: now,
    }) as never),
  });
}

// ─── 02 · Carrier Route Analysis ────────────────────────────────────────────

export async function generateCarrierRoute(req: CarrierRouteRequest): Promise<GenerateOutcome> {
  const now = req.now ?? new Date();
  if (!req.areaName.trim()) return { ok: false, reportId: null, stage: 'input', message: 'Enter the area name.' };
  if (!RANK_BY.includes(req.rankBy)) return { ok: false, reportId: null, stage: 'input', message: 'Choose what to rank the routes by.' };

  const parsed = parseRouteRows(req.csv);
  const problem = parseProblem(parsed, { routeId: 'carrier route' });
  if (problem) return { ok: false, reportId: null, stage: 'parse', message: problem };

  const rep = await loadRep(req.brandedToContactId);
  if (!rep.ok) return { ok: false, reportId: null, stage: 'input', message: rep.message };

  const figures = computeCarrierRoute(parsed.rows, req.rankBy);
  const q = quality(parsed);

  const [row] = await db.insert(carrierRouteReports).values({
    areaName: req.areaName.trim(),
    rankBy: req.rankBy,
    ...repColumns(req.brandedToContactId, rep.rep),
    datasetSource: 'csv_upload',
    datasetRows: q.rowsRead,
    datasetUsed: q.used,
    datasetRejected: q.rejected,
    rejectedTypes: q.rejectedTypes,
    listSubject: req.areaName.trim(),
    listSubjectDetail: `${figures.totalRoutes} ${figures.totalRoutes === 1 ? 'route' : 'routes'}`,
    listSettings: `Top ${figures.routes.length} by ${RANK_LABEL[req.rankBy]}`,
    standouts: figures.standouts as unknown as Record<string, unknown>,
    routes: figures.routes as unknown as Record<string, unknown>,
    templateVersion: CR_TEMPLATE,
    status: 'pending',
    createdBy: req.createdBy,
  }).returning({ id: carrierRouteReports.id });

  return storeAndRender({
    repWarning: rep.warning,
    type: 'carrier_route', table: carrierRouteReports, id: row!.id, csv: req.csv, now, quality: q,
    render: () => renderToBuffer(CarrierRouteDocument({
      areaName: req.areaName.trim(), rankBy: req.rankBy, figures, quality: q, rep: rep.rep, generatedAt: now,
    }) as never),
  });
}

// ─── 03 · County Sales ──────────────────────────────────────────────────────

export async function generateCountySales(req: CountySalesRequest): Promise<GenerateOutcome> {
  const now = req.now ?? new Date();
  if (!FARMING_COUNTIES.includes(req.county)) {
    return { ok: false, reportId: null, stage: 'input', message: `The county must be one of ${FARMING_COUNTIES.join(', ')}.` };
  }
  if (!MONTH_KEY.test(req.month)) return { ok: false, reportId: null, stage: 'input', message: 'Choose the month the file covers.' };

  const parsed = parseCountySaleRows(req.csv);
  const problem = parseProblem(parsed, { city: 'site city', price: 'purchase price', propertyType: 'property type' });
  if (problem) return { ok: false, reportId: null, stage: 'parse', message: problem };

  const rep = await loadRep(req.brandedToContactId);
  if (!rep.ok) return { ok: false, reportId: null, stage: 'input', message: rep.message };

  const figures = computeCountySales(parsed.rows);
  const q = quality(parsed);

  const [row] = await db.insert(countySalesReports).values({
    county: req.county,
    month: `${req.month}-01`,
    ...repColumns(req.brandedToContactId, rep.rep),
    datasetSource: 'csv_upload',
    datasetRows: q.rowsRead,
    datasetUsed: q.used,
    datasetRejected: q.rejected,
    rejectedTypes: q.rejectedTypes,
    listSubject: `${req.county} County`,
    listSubjectDetail: `${figures.cities.length} ${figures.cities.length === 1 ? 'city' : 'cities'}`,
    listSettings: monthLabel(req.month),
    cities: figures.cities as unknown as Record<string, unknown>,
    totals: { ...figures.totals, otherKinds: figures.otherKinds } as unknown as Record<string, unknown>,
    templateVersion: CS_TEMPLATE,
    status: 'pending',
    createdBy: req.createdBy,
  }).returning({ id: countySalesReports.id });

  return storeAndRender({
    repWarning: rep.warning,
    type: 'county_sales', table: countySalesReports, id: row!.id, csv: req.csv, now, quality: q,
    render: () => renderToBuffer(CountySalesDocument({
      county: req.county, monthKey: req.month, figures, quality: q, rep: rep.rep, generatedAt: now,
    }) as never),
  });
}

/** Exported for the test that checks the page count against the city count. */
export const COUNTY_PAGES = (cities: number) => Math.max(1, Math.ceil(cities / CITIES_PER_PAGE));

// ─── Try again ──────────────────────────────────────────────────────────────

const TABLE_FOR = {
  sales_activity: salesActivityReports,
  carrier_route: carrierRouteReports,
  county_sales: countySalesReports,
} as const;

/**
 * The template each type's document is on TODAY, beside the table it is stored
 * in. Read only by the re-render's staleness check — the generate paths stamp
 * the same constants directly, which is what makes the comparison meaningful.
 */
export const TEMPLATE_FOR = {
  sales_activity: SA_TEMPLATE,
  carrier_route: CR_TEMPLATE,
  county_sales: CS_TEMPLATE,
} as const;

export type RerenderOutcome =
  | { ok: true; reportId: number; pdfStorageKey: string; pageCount: number }
  | { ok: false; reason: 'not_found' | 'not_failed' | 'no_dataset' | 'stale_template' | 'bad_figures' | 'render' | 'store'; message: string };

/** A stored figure object that is not the shape the document reads. */
const badFigures = (missing: string): RerenderOutcome => ({
  ok: false,
  reason: 'bad_figures',
  message: `This report's stored figures are missing ${missing}, so it cannot be rendered again. Create it again from its dataset.`,
});

/**
 * "Try again" on a failed farming report: render it again from the figures the
 * row already stores, and store the PDF. Free, and it cannot change a number:
 * the figures were computed once, from the stored file, and are only read here.
 *
 * A report whose uploaded file was never stored is REFUSED. The generator will
 * not produce a report it cannot reproduce, and retrying one would do exactly
 * that — so it says to create the report again from the file.
 */
export async function rerenderFarming(
  type: 'sales_activity' | 'carrier_route' | 'county_sales',
  id: number,
  now: Date = new Date(),
): Promise<RerenderOutcome> {
  const table = TABLE_FOR[type];
  const [row] = await db.select().from(table).where(eq(table.id, id)).limit(1);
  if (!row) return { ok: false, reason: 'not_found', message: 'No such report.' };
  if (row.status !== 'failed') return { ok: false, reason: 'not_failed', message: 'Only a failed report can be tried again.' };
  if (!row.datasetStorageKey) {
    return {
      ok: false, reason: 'no_dataset',
      message: 'The uploaded file was never stored, so this report cannot be rebuilt from it. Create it again from the file.',
    };
  }

  // ─── THE TEMPLATE MUST MATCH ──────────────────────────────────────────────
  //
  // The figures below are rendered through TODAY'S document, and they were
  // computed for the document that existed when the row was written. A layout
  // change between the two means a field the new document reads may not be in
  // the stored object at all — and because these are jsonb, it arrives as
  // `undefined` and prints as a blank rather than failing.
  //
  // The version stamp exists for exactly this, and Concierge already relies on
  // it: profile #3 stays on v1 with its original PDF while #4 is on v2, so an
  // old document is always tied to the template that made it. Farming stored
  // the same column and never read it.
  //
  // Refusing is right rather than rendering anyway. The report can be created
  // again from its stored dataset, which produces figures that match the
  // current document by construction.
  const currentTemplate = TEMPLATE_FOR[type];
  if (row.templateVersion !== currentTemplate) {
    return {
      ok: false,
      reason: 'stale_template',
      message: `This report was built for document template ${row.templateVersion ?? 'unknown'}, and the current template is ${currentTemplate}. `
        + 'Re-rendering would print today’s layout from figures computed for the old one. Create it again from its dataset instead.',
    };
  }

  const q: DataQuality = {
    rowsRead: row.datasetRows, used: row.datasetUsed, rejected: row.datasetRejected,
    rejectedTypes: (row.rejectedTypes ?? {}) as Record<string, number>,
  };
  const rep: RepBlock = {
    name: row.brandedToName, title: row.brandedToTitle, phone: row.brandedToPhone, email: row.brandedToEmail, photo: null,
  };

  // THE STORED FIGURES ARE CHECKED, NOT CAST. `as never` silenced the compiler
  // on every one of these, which is the same mechanism that let the Concierge
  // comp mapping drop five fields without anyone finding out: nothing asks, so
  // a missing value arrives as undefined and prints as a blank. A shape that
  // is not what we think now refuses by name.
  let render: () => Promise<Buffer>;
  if (type === 'sales_activity') {
    const r = row as typeof salesActivityReports.$inferSelect;
    const f = salesActivityFigures(r.metrics, r.months);
    if (!f.ok) return badFigures(f.missing);
    render = () => renderToBuffer(SalesActivityDocument({
      areaName: r.areaName, propertyType: r.propertyType, windowMonths: r.windowMonths,
      windowEndKey: String(r.windowEnd).slice(0, 7),
      figures: f.figures,
      quality: q, rep, generatedAt: now,
    }) as never);
  } else if (type === 'carrier_route') {
    const r = row as typeof carrierRouteReports.$inferSelect;
    // Every route that could be read was in the file; the total is what was
    // used. Pinned in rerender-parity.test.ts.
    const f = carrierRouteFigures(r.routes, r.standouts, r.datasetUsed);
    if (!f.ok) return badFigures(f.missing);
    render = () => renderToBuffer(CarrierRouteDocument({
      areaName: r.areaName, rankBy: r.rankBy as RankBy,
      figures: f.figures,
      quality: q, rep, generatedAt: now,
    }) as never);
  } else {
    const r = row as typeof countySalesReports.$inferSelect;
    const f = countySalesFigures(r.cities, r.totals);
    if (!f.ok) return badFigures(f.missing);
    render = () => renderToBuffer(CountySalesDocument({
      county: r.county, monthKey: String(r.month).slice(0, 7),
      figures: f.figures,
      quality: q, rep, generatedAt: now,
    }) as never);
  }

  const out = await renderAndStore({ type, table, id, now, render, quality: q });
  if (out.ok) return { ok: true, reportId: id, pdfStorageKey: out.pdfStorageKey, pageCount: out.pageCount };
  return { ok: false, reason: out.stage === 'render' ? 'render' : 'store', message: out.message };
}
