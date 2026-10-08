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
  /**
   * SiteX's OWN figure, from SaleLoanInfo.PricePerSQFT. Never price / area.
   *
   * The payload carries two building areas — PropertyCharacteristics.BuildingArea
   * and Neighborhood[].BuildingArea, 786 and 793 on the same parcel — so a
   * computed rate depends on which one you happen to divide by, and nothing
   * says which is right. concierge_comps.price_per_sqft already carries the
   * same annotation: recomputing from BuildingArea was the legacy bug.
   */
  lastSalePricePerSqft: number | null;

  // ── v6 page 3 ──────────────────────────────────────────────────────────
  // Additive. Every one was already in the payload and simply not read; the
  // alternative was printing an em dash over data we had bought.
  // There is no page-grid field in feed 100001 — that row renders a gap.
  /** PP.MailAddressFull. Differs from the site address on absentee owners. */
  mailAddressFull: string | null;
  /** PP.CensusTract. */
  censusTract: string | null;
  /** PP.PropertyCharacteristics.GarageTypeWithNumCars, e.g. "Attached / 2". */
  garage: string | null;
  pool: string | null;
  zoning: string | null;
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
  /**
   * ─── What the transfer was for, and between whom ──────────────────────────
   *
   * Legacy's profile carried these and v6 dropped them; a rep asked for them
   * back (Gerard, 2026-10-07). Privacy is settled: these are recorded
   * documents, public by definition.
   *
   * THE FIELD NAMES ARE MEASURED, NOT ASSUMED, across the 44 transfers on
   * profiles 12 and 13 — because reading keys SiteX never sends is how
   * normalizeSubject went wrong once already. None of them are top-level:
   *
   *   Deed.SalesPrice                        7/11 deeds
   *   Deed.BuyerInfo.BuyerNames             10/11
   *   Deed.SellerInfo.SellerNames           10/11
   *   Mortgage.LoanAmount                   17/18 mortgages
   *   Mortgage.BorrowerInfo.BorrowerNames   18/18
   *   Mortgage.LenderName                   18/18
   *
   * WHICH ONE APPLIES DEPENDS ON THE DOCUMENT. A deed has a price and a buyer
   * and seller; a mortgage has a loan and a borrower and lender. They are not
   * the same quantity and must not share a column heading that implies they
   * are — see the document.
   *
   * The mailing addresses sitting beside the names in the same objects are
   * deliberately not read. The ask was names and amounts.
   */
  amount: number | null;
  /** 'sale' for a deed's price, 'loan' for a mortgage's. Null when neither. */
  amountKind: 'sale' | 'loan' | null;
  /** Buyer on a deed, borrower on a mortgage or release. */
  partyTo: string | null;
  /** Seller on a deed, lender on a mortgage. */
  partyFrom: string | null;
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
    // SalesPrice and TransferDate FIRST, because those are the names feed
    // 100001 actually uses. The three alternatives each name led with —
    // LastTransferValue, SalePrice, LastSaleDate — appear in NO stored payload:
    // SaleLoanInfo carries exactly Book, DocumentNumber, LenderName, LoanAmount,
    // Page, PricePerSQFT, SalesPrice, SellerName, TitleCompany, TransferDate.
    // Reading only the absent names is why every profile printed "No subject
    // sale on record" while the payload held a price and a date.
    // The others are kept as fallbacks: they cost nothing and another feed id
    // may well use them.
    lastSaleDate: toIsoDate(sl.TransferDate ?? sl.LastTransferRecordingDate ?? sl.RecordingDate ?? sl.LastSaleDate),
    lastSalePrice: num(sl.SalesPrice ?? sl.LastTransferValue ?? sl.SalePrice ?? sl.LastSalePrice),
    lastSalePricePerSqft: num(sl.PricePerSQFT),

    mailAddressFull: str(p.MailAddressFull),
    censusTract: str(p.CensusTract),
    // "/ 0" when there is no garage and no type — a slash and a zero is not a
    // value a reader can use, so it reads as a gap.
    garage: (() => {
      const g = str(ch.GarageTypeWithNumCars);
      if (!g) return null;
      return /^[\s/0]*$/.test(g) ? null : g.replace(/^\s*\/\s*/, '').trim() || null;
    })(),
    pool: str(ch.Pool),
    zoning: str(ch.Zoning),
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

/** A nested block on a transfer — Deed, Mortgage, Release, Foreclosure. */
const sub = (t: Raw, key: string): Raw =>
  (t[key] && typeof t[key] === 'object' && !Array.isArray(t[key]) ? t[key] as Raw : {});

/**
 * The money and the parties, chosen by what kind of document it is.
 *
 * A DEED IS CHECKED BEFORE A MORTGAGE because a single record can carry both
 * blocks — a purchase with financing — and in that case the sale price is the
 * figure a reader is looking for. The loan is still on its own row, since
 * SiteX records the mortgage as its own transfer.
 */
function transferDetail(t: Raw): Pick<NormalizedTransfer, 'amount' | 'amountKind' | 'partyTo' | 'partyFrom'> {
  const deed = sub(t, 'Deed');
  const mortgage = sub(t, 'Mortgage');
  const release = sub(t, 'Release');

  const salePrice = money(deed.SalesPrice);
  if (salePrice !== null || deed.BuyerInfo || deed.SellerInfo) {
    return {
      amount: salePrice,
      amountKind: salePrice === null ? null : 'sale',
      partyTo: str(sub(deed, 'BuyerInfo').BuyerNames),
      partyFrom: str(sub(deed, 'SellerInfo').SellerNames),
    };
  }

  const loan = money(mortgage.LoanAmount);
  if (loan !== null || mortgage.BorrowerInfo || mortgage.LenderName) {
    return {
      amount: loan,
      amountKind: loan === null ? null : 'loan',
      partyTo: str(sub(mortgage, 'BorrowerInfo').BorrowerNames),
      partyFrom: str(mortgage.LenderName),
    };
  }

  // A release names the borrower whose loan is being released, and carries the
  // original loan's amount rather than one of its own.
  if (release.BuyerorBorrower1LastOrCorporateName || release.OriginalLoan) {
    const original = money(sub(release, 'OriginalLoan').LoanAmount);
    return {
      amount: original,
      amountKind: original === null ? null : 'loan',
      partyTo: str(release.BuyerorBorrower1LastOrCorporateName),
      partyFrom: str(release.CurrentBeneficiaryLender ?? release.OriginalBeneficiaryLender),
    };
  }

  return { amount: null, amountKind: null, partyTo: null, partyFrom: null };
}

/** "833500" -> 833500. Blank, zero and unparseable all become null. */
function money(v: unknown): number | null {
  const s = String(v ?? '').replace(/[$,\s]/g, '').trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function normalizeTransfers(feed: Raw): NormalizedTransfer[] {
  return arr(feed.TransferHistory).map((t, i) => ({
    sourcePosition: i,
    ...transferDetail(t),
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
