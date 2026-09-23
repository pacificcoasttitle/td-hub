import type { CompCandidate, SubjectFacts } from './comp-filter';

// ─── SiteX feed 100001 → our shapes ──────────────────────────────────────────
//
// Pure. Nothing here invents a value: a field SiteX omits becomes null and the
// document renders the gap. On a real property SaleLoanInfo came back with zero
// keys, so "the subject has no recorded last sale" is a normal outcome, not an
// error, and never a reason to borrow a comparable's figure.

type Raw = Record<string, unknown>;

const str = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
};

const num = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const cleaned = v.replace(/[$,\s]/g, '');
    if (cleaned === '') return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const int = (v: unknown): number | null => {
  const n = num(v);
  return n === null ? null : Math.round(n);
};

/** SiteX dates arrive as 'M/D/YYYY h:mm:ss A' or 'YYYYMMDD'. Return ISO or null. */
export function toIsoDate(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

const obj = (v: unknown): Raw => (v && typeof v === 'object' && !Array.isArray(v) ? v as Raw : {});
const arr = (v: unknown): Raw[] => (Array.isArray(v) ? v as Raw[] : []);

export interface NormalizedSubject {
  apn: string | null;
  fips: string | null;
  county: string | null;
  useCode: string | null;
  useDescription: string | null;
  primaryOwner: string | null;
  siteAddress: string | null;
  siteCityState: string | null;
  legalDescription: string | null;
  /** From LegalDescriptionInfo, structured — never parsed out of the string above. */
  tractNumber: string | null;
  lotNumber: string | null;
  block: string | null;
  subdivision: string | null;
  beds: number | null;
  baths: number | null;
  buildingArea: number | null;
  lotSize: number | null;
  lotSizeLabel: string | null;
  yearBuilt: number | null;
  latitude: number | null;
  longitude: number | null;
  /** Null is a legitimate answer — see the module note. */
  lastSaleDate: string | null;
  lastSalePrice: number | null;
}

export interface NormalizedTax {
  year: number | null;
  assessedValue: number | null;
  landValue: number | null;
  improvementValue: number | null;
  marketValue: number | null;
  taxAmount: number | null;
  status: string | null;
}

export interface NormalizedTransfer {
  sourcePosition: number;
  transactionType: string | null;
  documentType: string | null;
  recordingDate: string | null;
  contractDate: string | null;
  documentNumber: string | null;
  bookNumber: string | null;
  pageNumber: string | null;
  currentOwnerFlag: boolean | null;
  isForeclosure: boolean | null;
  raw: Raw;
}

export interface NormalizedPlatMap {
  filename: string | null;
  status: string | null;
  /** base64 payload, if SiteX supplied one. */
  content: string | null;
}

export function normalizeSubject(feed: Raw): NormalizedSubject {
  const p = obj(feed.PropertyProfile);
  const ch = obj(p.PropertyCharacteristics);
  const sl = obj(p.SaleLoanInfo);
  const legal = obj(p.LegalDescriptionInfo);
  return {
    apn: str(p.APN),
    fips: str(p.FIPS),
    county: str(p.CountyName),
    useCode: str(ch.UseCode),
    useDescription: str(ch.UseCodeDescription),
    primaryOwner: str(p.PrimaryOwnerName),
    siteAddress: str(p.SiteAddress),
    // NOT SiteAddressCityState — that field already contains the street line
    // ("10523 STONYBROOK AVE, SOUTH GATE, CA 90280"), so pairing it with
    // siteAddress printed the address twice on the cover. Build the locality
    // line from the discrete fields instead.
    siteCityState: (() => {
      const city = str(p.SiteCity);
      const state = str(p.SiteState);
      const zip = str(p.SiteZip);
      const line = [city, [state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
      return line || str(p.SiteAddressCityState);
    })(),
    legalDescription: str(legal.LegalBriefDescription),
    // STRUCTURED, so the document never has to parse the brief description.
    // SiteX sends both: "TRACT NO 6654 LOT 44" AND TractNumber "6654",
    // LotNumber "44". Reading the string was a parser with failure modes —
    // an early cut captured "NO" as the tract on every one of our own
    // profiles, because the sample in the design mock says "TRACT # 14627"
    // and both live payloads say "TRACT NO 6654". These fields have no such
    // ambiguity; the string stays as the as-recorded line.
    tractNumber: str(legal.TractNumber),
    lotNumber: str(legal.LotNumber),
    block: str(legal.Block),
    subdivision: str(legal.Subdivision),
    beds: int(ch.Bedrooms),
    baths: num(ch.Baths),
    buildingArea: int(ch.BuildingArea),
    lotSize: int(ch.LotSize),
    lotSizeLabel: str(ch.LotSizeWithUnitType),
    yearBuilt: int(ch.YearBuilt),
    latitude: num(ch.Latitude),
    longitude: num(ch.Longitude),
    lastSaleDate: toIsoDate(sl.LastTransferRecordingDate ?? sl.RecordingDate ?? sl.LastSaleDate),
    lastSalePrice: num(sl.LastTransferValue ?? sl.SalePrice ?? sl.LastSalePrice),
  };
}

export function normalizeTax(feed: Raw): NormalizedTax {
  const t = obj(obj(feed.PropertyProfile).AssessmentTaxInfo);
  return {
    year: int(t.TaxYear),
    assessedValue: num(t.AssessedValue),
    landValue: num(t.LandValue),
    improvementValue: num(t.ImprovementValue),
    marketValue: num(t.MarketValue),
    taxAmount: num(t.TaxAmount),
    status: str(t.TaxStatus),
  };
}

/** The comp array key carries a dot, which is a SiteX quirk, not a nesting. */
export const COMP_KEY = 'ComparableSalesReport.ComparableSales';

/**
 * A comparable as the payload gives it, before any filtering.
 *
 * NAMED, because two paths build the document and both must agree on what a
 * comparable is: the generate path uses this, and the re-render path rebuilds
 * it from stored rows (see comp-row.ts). While the shape was inline here, the
 * two could diverge field by field with nothing to notice — and they did.
 */
export type NormalizedComp = CompCandidate & {
  raw: Raw;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  apn: string | null;
  documentNumber: string | null;
  documentType: string | null;
  latitude: number | null;
  longitude: number | null;
};

export function normalizeComps(feed: Raw): NormalizedComp[] {
  return arr(feed[COMP_KEY]).map((c, i) => ({
    sourcePosition: i,
    salePrice: num(c.SalePrice),
    pricePerSqft: num(c.PricePerSQFT),
    buildingArea: int(c.BuildingArea),
    bedrooms: int(c.Bedrooms),
    baths: num(c.Baths),
    yearBuilt: int(c.YearBuilt),
    lotSize: int(c.LotSize),
    proximityMiles: num(c.Proximity),
    recordingDate: toIsoDate(c.RecordingDate),
    useCodeDescription: str(c.UseCodeDescription),
    address: str(c.SiteAddress),
    city: str(c.SiteCity),
    state: str(c.SiteState),
    zip: str(c.SiteZip),
    apn: str(c.APN),
    documentNumber: str(c.DocumentNumber),
    documentType: str(c.DocumentType),
    latitude: num(c.Latitude),
    longitude: num(c.Longitude),
    raw: c,
  }));
}

/**
 * SiteX writes this flag as the STRING 'True' — not a boolean, and not the
 * 'Y'/'N' this parser originally assumed. Every transfer on the reference
 * parcel carries 'True', so the old parse returned null for all thirteen and
 * the document's CURRENT column was blank on every row.
 */
const boolFlag = (v: unknown): boolean | null => {
  if (typeof v === 'boolean') return v;
  const s = str(v)?.toUpperCase();
  if (s === 'Y' || s === 'YES' || s === 'TRUE') return true;
  if (s === 'N' || s === 'NO' || s === 'FALSE') return false;
  return null;
};

/**
 * Foreclosure is NOT a flag. It is either null or an OBJECT of foreclosure
 * detail — auction dates, trustee, delinquent amounts. Comparing it to 'Y'
 * could never have matched anything.
 *
 * The object is present on exactly the two transfers whose TransactionType is
 * 'Foreclosure' and absent on the other eleven: two independent fields
 * agreeing on all thirteen rows, and a test that separates 2 from 11 rather
 * than collapsing them.
 *
 * What `true` does NOT mean: one of those two is a foreclosure CANCELLATION.
 * This records that a foreclosure-related instrument was recorded, not that
 * the property is in foreclosure. The document deliberately prints the
 * document type instead of this boolean, so a reader sees "Foreclosure
 * Cancellation" rather than an alarming Yes.
 *
 * An explicit null means SiteX reported no foreclosure on that transfer.
 * An ABSENT key means it reported nothing at all, which is not the same, and
 * stays null.
 */
const foreclosureFlag = (v: unknown): boolean | null => {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'object' && v !== null) return true;
  if (v === null) return false;
  return boolFlag(v);
};

export function normalizeTransfers(feed: Raw): NormalizedTransfer[] {
  return arr(feed.TransferHistory).map((t, i) => ({
    sourcePosition: i,
    transactionType: str(t.TransactionType),
    documentType: str(t.DocumentType),
    recordingDate: toIsoDate(t.RecordingDate),
    contractDate: toIsoDate(t.ContractDate),
    documentNumber: str(t.RecorderDocumentNumber),
    bookNumber: str(t.RecorderBookNumber),
    pageNumber: str(t.RecorderPageNumber),
    currentOwnerFlag: boolFlag(t.CurrentOwnerFlag),
    isForeclosure: foreclosureFlag(t.Foreclosure),
    raw: t,
  }));
}

/**
 * PlatMap is an OBJECT with the image inline as base64 — not a URL.
 * Status can be other than 'Available', in which case there is no image and the
 * document renders the absence.
 */
export function normalizePlatMap(feed: Raw): NormalizedPlatMap | null {
  const pm = feed.PlatMap;
  if (!pm || typeof pm !== 'object') return null;
  const o = obj(pm);
  return { filename: str(o.FileName), status: str(o.Status), content: str(o.Content) };
}

export function subjectFacts(s: NormalizedSubject): SubjectFacts {
  return {
    buildingArea: s.buildingArea,
    bedrooms: s.beds,
    baths: s.baths,
    useCodeDescription: s.useDescription,
  };
}
