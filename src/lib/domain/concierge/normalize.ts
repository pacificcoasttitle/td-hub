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
    siteCityState: str(p.SiteAddressCityState),
    legalDescription: str(legal.LegalBriefDescription),
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

export function normalizeComps(feed: Raw): Array<CompCandidate & { raw: Raw; address: string | null; city: string | null; state: string | null; zip: string | null; apn: string | null; documentNumber: string | null; documentType: string | null; latitude: number | null; longitude: number | null }> {
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
    currentOwnerFlag: typeof t.CurrentOwnerFlag === 'boolean' ? t.CurrentOwnerFlag
      : str(t.CurrentOwnerFlag) === 'Y' ? true : str(t.CurrentOwnerFlag) === 'N' ? false : null,
    isForeclosure: typeof t.Foreclosure === 'boolean' ? t.Foreclosure
      : str(t.Foreclosure) === 'Y' ? true : str(t.Foreclosure) === 'N' ? false : null,
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
