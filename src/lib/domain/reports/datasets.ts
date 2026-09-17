/**
 * Dataset contracts for the three farming reports.
 *
 * ─── THE INTERFACE IS THE DATASET, NOT THE FILE ─────────────────────────────
 *
 * Each report reads a named dataset. CSV upload is one producer; SiteX Farms
 * will be another. Nothing in the documents changes when the second arrives —
 * which only holds if the shapes below, rather than a set of column headers,
 * are what the reports are written against.
 *
 * So the parsers here map HEADERS to fields by alias, and anything they cannot
 * place is reported rather than dropped. A header we have never seen is a fact
 * about the feed, not a reason to silently produce a thinner report.
 *
 * ─── THE THREE DEFECTS THIS MODULE EXISTS TO NOT REBUILD ────────────────────
 *
 * 1. MEDIAN MEANS MEDIAN. Legacy's County report labelled a column Median and
 *    computed array_sum / count. The label was right, so the maths changed.
 *    Price per square foot is the median of each home's OWN rate, never a ratio
 *    of two sums, and a county total is computed from the per-sale rows — a
 *    median of city medians is not a median.
 *
 * 2. PROPERTY TYPES COLLAPSE, AND REJECTS ARE COUNTED. Legacy lowercased and
 *    kept only 'rsfr' and 'rcon', so `Condo` and `SFR` were dropped in silence
 *    while `RCON` and `RSFR` worked. Every row that cannot be classified is
 *    counted against the value that produced it.
 *
 * 3. A WINDOW IS A DATE RANGE. Legacy matched month-number regardless of year,
 *    so a 12-month run ignored the year entirely and mixed three Augusts.
 */

// ─── Property type ──────────────────────────────────────────────────────────

export type PropertyKind = 'single_family' | 'condominium' | 'multi_family' | 'land' | 'other';

/**
 * What the feeds have actually been seen to send, in every casing. `other` is a
 * classification, not a bin for the unreadable: a row whose type is blank or
 * unknown is REJECTED and counted, never quietly folded in.
 */
const PROPERTY_KINDS: Record<string, PropertyKind> = {
  rsfr: 'single_family', sfr: 'single_family', 'single family': 'single_family',
  'single family residence': 'single_family', 'single-family': 'single_family', house: 'single_family',
  rcon: 'condominium', con: 'condominium', condo: 'condominium', condominium: 'condominium',
  townhouse: 'condominium', 'town house': 'condominium', pud: 'condominium',
  rmfd: 'multi_family', mfr: 'multi_family', duplex: 'multi_family', triplex: 'multi_family',
  fourplex: 'multi_family', 'multi family': 'multi_family', 'multi-family': 'multi_family',
  land: 'land', lot: 'land', vacant: 'land', 'vacant land': 'land',
};

export function classifyPropertyType(raw: string | null | undefined): PropertyKind | null {
  const key = (raw ?? '').trim().toLowerCase().replace(/[._/]+/g, ' ').replace(/\s+/g, ' ');
  if (!key) return null;
  return PROPERTY_KINDS[key] ?? null;
}

// ─── Statistics ─────────────────────────────────────────────────────────────

/** A true median. Even counts average the two middle values; empty is null. */
export function median(values: readonly number[]): number | null {
  const xs = values.filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = xs.length >> 1;
  return xs.length % 2 ? xs[mid]! : (xs[mid - 1]! + xs[mid]!) / 2;
}

/**
 * The median of each home's OWN price per square foot.
 *
 * NOT median(prices) / median(areas), and not sum(prices) / sum(areas): both
 * are ratios of aggregates, which is the figure legacy printed under a label
 * that said median. A sale with no area contributes nothing rather than a zero.
 */
export function medianPricePerSqft(rows: readonly { price: number | null; buildingArea: number | null }[]): number | null {
  const rates = rows
    .filter((r): r is { price: number; buildingArea: number } =>
      typeof r.price === 'number' && typeof r.buildingArea === 'number' && r.buildingArea > 0 && r.price > 0)
    .map((r) => r.price / r.buildingArea);
  return median(rates);
}

/** Share of rows where the flag is true, over rows where it is KNOWN. */
export function shareOf(rows: readonly (boolean | null)[]): number | null {
  const known = rows.filter((v): v is boolean => typeof v === 'boolean');
  if (known.length === 0) return null;
  return known.filter(Boolean).length / known.length;
}

// ─── Route ids ──────────────────────────────────────────────────────────────

/**
 * How a route id is printed — legacy's separateZipRoute, all four steps.
 *
 * Extracts glue the ZIP and the route together (904031C001). The rule is NOT
 * "split after five characters": when the ZIP is known and present, the hyphen
 * goes after THAT, and when it is not, four characters from the END. Those
 * disagree for any id whose route part is not five characters long.
 */
export function formatRouteId(mixed: string | null | undefined, zip?: string | null): string {
  const value = (mixed ?? '').trim();
  if (!value) return '';
  const z = (zip ?? '').trim();
  if (z && value.includes(z)) {
    const at = value.indexOf(z) + z.length;
    return `${value.slice(0, at)}-${value.slice(at)}`;
  }
  if (value.length > 5) return `${value.slice(0, value.length - 4)}-${value.slice(-4)}`;
  return value;
}

// ─── The dataset shapes ─────────────────────────────────────────────────────

/**
 * Sales Activity rows. Appendix A: APN / Parcel Number, Bedrooms, Baths,
 * Building Size, Owner Occupied, Purchase Price, Purchase Date.
 *
 * NO city and NO property type — the area name comes from the form, and this
 * file carries one area. Anything asking this dataset to filter by type is
 * asking the file for a column it has never had.
 */
export interface AreaSaleRow {
  apn: string | null;
  price: number;
  saleDate: Date;
  buildingArea: number | null;
  beds: number | null;
  baths: number | null;
  ownerOccupied: boolean | null;
}

/**
 * County Sales rows. Appendix A: Site City, Purchase Price, Property Type.
 * No dates — the month comes from the form, and the file is one month.
 */
export interface CountySaleRow {
  city: string;
  price: number;
  propertyKind: PropertyKind;
}

/**
 * Route metrics, pre-aggregated. We rank and format only.
 *
 * NOTE THE NAMES: the feed sends `avg_price` and `avg_yr_owned`. They are
 * AVERAGES, and the fields are named so nothing downstream can print them under
 * a column saying median. That mislabelling is the exact defect being fixed in
 * County Sales; it must not be reintroduced here by a hopeful field name.
 */
export interface RouteRow {
  routeId: string;
  zip: string | null;
  city: string | null;
  totalUnits: number | null;
  totalSales: number | null;
  avgPrice: number | null;
  turnoverRate: number | null;
  nonOwnerRatio: number | null;
  avgYearsOwned: number | null;
}

export interface ParseReport<T> {
  rows: T[];
  /** Rows read from the file, excluding the header. */
  total: number;
  /** Rows that produced a usable record. */
  used: number;
  /** Rows dropped, counted against the value that caused it. Never silent. */
  rejected: number;
  rejectedTypes: Record<string, number>;
  /** Headers in the file we could not place. A fact about the feed. */
  unmappedHeaders: string[];
  /** Fields the report needs that no header supplied. */
  missingFields: string[];
}

// ─── Header mapping ─────────────────────────────────────────────────────────

const norm = (h: string) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Headers, copied from Appendix A of the farming guide, plus the spellings the
 * same exports have used. "APN / Parcel Number" keeps its slashes and spaces —
 * the guide is explicit that they are part of the contract — and normalisation
 * makes that survive anyway.
 *
 * A header we cannot place is REPORTED in `unmappedHeaders`. The guide says the
 * importer ignores extra QA columns; ignoring them silently is what stops a
 * changed feed from announcing itself.
 */
const AREA_SALE_HEADERS: Record<string, string[]> = {
  apn: ['apn parcel number', 'apn', 'parcel number'],
  beds: ['bedrooms', 'beds', 'bed', 'br'],
  baths: ['baths', 'bathrooms', 'bath', 'ba'],
  buildingArea: ['building size', 'building area', 'sq ft', 'sqft', 'square feet', 'living area'],
  ownerOccupied: ['owner occupied', 'owner occupancy', 'occupancy'],
  price: ['purchase price', 'sale price', 'price', 'sales price'],
  saleDate: ['purchase date', 'sale date', 'recording date', 'close date'],
};

const COUNTY_SALE_HEADERS: Record<string, string[]> = {
  city: ['site city', 'city', 'property city'],
  price: ['purchase price', 'sale price', 'price', 'sales price'],
  propertyType: ['property type', 'use code', 'type', 'land use'],
};

const ROUTE_HEADERS: Record<string, string[]> = {
  routeId: ['carrier route', 'route', 'route id', 'crrt'],
  avgPrice: ['avg price', 'average price', 'avg sale price'],
  turnoverRate: ['turnover rate', 'turnover', 't o'],
  totalSales: ['total sales', 'sales', 'sold'],
  nonOwnerRatio: ['noo ratio', 'non owner', 'non owner occupied', 'noo'],
  avgYearsOwned: ['avg yr owned', 'average years owned', 'years owned', 'years held'],
  totalUnits: ['total units', 'units', 'deliveries'],
  zip: ['sa site zip', 'zip', 'zip code', 'site zip'],
  city: ['sa site city', 'city', 'site city'],
};

function indexHeaders(header: string[], spec: Record<string, string[]>) {
  const seen = header.map(norm);
  const index: Record<string, number> = {};
  const claimed = new Set<number>();
  for (const [field, aliases] of Object.entries(spec)) {
    const at = seen.findIndex((h, i) => !claimed.has(i) && aliases.includes(h));
    if (at >= 0) { index[field] = at; claimed.add(at); }
  }
  const unmapped = header.filter((_, i) => !claimed.has(i) && seen[i] !== '');
  return { index, unmapped };
}

const num = (v: string | undefined): number | null => {
  if (v === undefined) return null;
  const cleaned = v.replace(/[$,%\s,]/g, '');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};

const bool = (v: string | undefined): boolean | null => {
  const s = (v ?? '').trim().toLowerCase();
  if (['y', 'yes', 'true', '1', 'owner', 'owner occupied'].includes(s)) return true;
  if (['n', 'no', 'false', '0', 'absentee', 'non owner', 'non-owner'].includes(s)) return false;
  return null;
};

const date = (v: string | undefined): Date | null => {
  const s = (v ?? '').trim();
  if (!s) return null;
  const d = new Date(/^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}` : s);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Minimal CSV split: quoted fields, doubled quotes, commas inside quotes. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

function readCsv(text: string): { header: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) return { header: [], rows: [] };
  return { header: splitCsvLine(lines[0]!), rows: lines.slice(1).map(splitCsvLine) };
}

/** Sales Activity: per-sale rows, one area, priced and dated. */
export function parseAreaSaleRows(text: string): ParseReport<AreaSaleRow> {
  const { header, rows } = readCsv(text);
  const { index, unmapped } = indexHeaders(header, AREA_SALE_HEADERS);
  const missingFields = ['price', 'saleDate'].filter((f) => index[f] === undefined);

  const out: AreaSaleRow[] = [];
  const rejectedTypes: Record<string, number> = {};
  let rejected = 0;

  for (const r of rows) {
    const price = index.price === undefined ? null : num(r[index.price]);
    const saleDate = index.saleDate === undefined ? null : date(r[index.saleDate]);
    if (price === null || saleDate === null) {
      rejected++;
      const why = price === null ? '(no price)' : '(no purchase date)';
      rejectedTypes[why] = (rejectedTypes[why] ?? 0) + 1;
      continue;
    }
    out.push({
      apn: index.apn === undefined ? null : (r[index.apn] ?? '').trim() || null,
      price,
      saleDate,
      buildingArea: index.buildingArea === undefined ? null : num(r[index.buildingArea]),
      beds: index.beds === undefined ? null : num(r[index.beds]),
      baths: index.baths === undefined ? null : num(r[index.baths]),
      ownerOccupied: index.ownerOccupied === undefined ? null : bool(r[index.ownerOccupied]),
    });
  }

  return { rows: out, total: rows.length, used: out.length, rejected, rejectedTypes, unmappedHeaders: unmapped, missingFields };
}

/** County Sales: per-sale rows, one month, city and type. */
export function parseCountySaleRows(text: string): ParseReport<CountySaleRow> {
  const { header, rows } = readCsv(text);
  const { index, unmapped } = indexHeaders(header, COUNTY_SALE_HEADERS);
  const missingFields = ['city', 'price', 'propertyType'].filter((f) => index[f] === undefined);

  const out: CountySaleRow[] = [];
  const rejectedTypes: Record<string, number> = {};
  let rejected = 0;

  for (const r of rows) {
    const rawType = index.propertyType === undefined ? '' : (r[index.propertyType] ?? '');
    const kind = classifyPropertyType(rawType);
    const price = index.price === undefined ? null : num(r[index.price]);
    const city = index.city === undefined ? '' : (r[index.city] ?? '').trim();
    if (kind === null || price === null || !city) {
      rejected++;
      const why = kind === null ? (rawType.trim() || '(blank type)') : price === null ? '(no price)' : '(no city)';
      rejectedTypes[why] = (rejectedTypes[why] ?? 0) + 1;
      continue;
    }
    // Case-normalised: the county page lists cities alphabetically and IRVINE
    // must not sit apart from Irvine.
    out.push({ city: city.replace(/\s+/g, ' '), price, propertyKind: kind });
  }

  return { rows: out, total: rows.length, used: out.length, rejected, rejectedTypes, unmappedHeaders: unmapped, missingFields };
}

/** Route metrics: pre-aggregated per route. We rank and format only. */
export function parseRouteRows(text: string): ParseReport<RouteRow> {
  const { header, rows } = readCsv(text);
  const { index, unmapped } = indexHeaders(header, ROUTE_HEADERS);
  const missingFields = ['routeId'].filter((f) => index[f] === undefined);

  const out: RouteRow[] = [];
  const rejectedTypes: Record<string, number> = {};
  let rejected = 0;

  for (const r of rows) {
    const rawId = index.routeId === undefined ? '' : (r[index.routeId] ?? '');
    const zip = index.zip === undefined ? null : (r[index.zip] ?? '').trim() || null;
    const routeId = formatRouteId(rawId, zip);
    if (!routeId) {
      rejected++;
      rejectedTypes['(blank route id)'] = (rejectedTypes['(blank route id)'] ?? 0) + 1;
      continue;
    }
    out.push({
      routeId,
      zip,
      city: index.city === undefined ? null : (r[index.city] ?? '').trim() || null,
      totalUnits: index.totalUnits === undefined ? null : num(r[index.totalUnits]),
      totalSales: index.totalSales === undefined ? null : num(r[index.totalSales]),
      avgPrice: index.avgPrice === undefined ? null : num(r[index.avgPrice]),
      turnoverRate: index.turnoverRate === undefined ? null : num(r[index.turnoverRate]),
      nonOwnerRatio: index.nonOwnerRatio === undefined ? null : num(r[index.nonOwnerRatio]),
      avgYearsOwned: index.avgYearsOwned === undefined ? null : num(r[index.avgYearsOwned]),
    });
  }

  return { rows: out, total: rows.length, used: out.length, rejected, rejectedTypes, unmappedHeaders: unmapped, missingFields };
}

/**
 * The winner of ONE metric among the rows given.
 *
 * Each tile is computed from its own field. Legacy's HIGHEST NON-OWNER tile
 * printed `turnover_rate`'s route beside the non-owner percentage, so the number
 * and the route under it described different places.
 */
export function standoutBy<T>(rows: readonly T[], field: (r: T) => number | null): T | null {
  let best: T | null = null;
  let bestValue = -Infinity;
  for (const r of rows) {
    const v = field(r);
    if (v === null || !Number.isFinite(v)) continue;
    if (v > bestValue) { bestValue = v; best = r; }
  }
  return best;
}

// ─── Windows ────────────────────────────────────────────────────────────────

export interface DateWindow { start: Date; end: Date }

/** A real range ending at the given month, inclusive of both ends. */
export function monthWindow(endMonth: Date, months: number): DateWindow {
  const end = new Date(Date.UTC(endMonth.getUTCFullYear(), endMonth.getUTCMonth() + 1, 0));
  const start = new Date(Date.UTC(endMonth.getUTCFullYear(), endMonth.getUTCMonth() - (months - 1), 1));
  return { start, end };
}

/** Inside the window by DATE. Not by month number — that mixed three Augusts. */
export function withinWindow(d: Date | null, w: DateWindow): boolean {
  return d !== null && d.getTime() >= w.start.getTime() && d.getTime() <= w.end.getTime();
}

/** `2026-08` for grouping, always with the year. */
export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
