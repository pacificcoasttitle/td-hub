import type { CompFilterResult } from '../comp-filter';
import type { NormalizedSubject, NormalizedTax, NormalizedTransfer } from '../normalize';

/**
 * ─── What the v3 layout needs that the payload does not hand over whole ─────
 *
 * The redesign spec marks most of page 2, 3 and 4 as "Stored". It is not quite:
 * the FIELDS are stored, but three of them arrive as one string that the new
 * layout splits into separate cells. Those splits are parsers, and parsers have
 * failure modes, so they live here — pure, alone, and tested — rather than
 * inline in a 600-line document component where a bad split would print as a
 * confident wrong value.
 *
 * THE RULE THROUGHOUT: when a parse does not clearly succeed, return null and
 * let the document render its em dash. A half-parsed owner name or a guessed
 * tract number on a title company's document is worse than a gap, because a gap
 * is visibly a gap.
 */

// ─── Owner names ────────────────────────────────────────────────────────────

export interface ParsedOwner {
  /** Natural reading order — "Elwood N Christensen". */
  display: string;
  /** Exactly as the county recorded it — "CHRISTENSEN ELWOOD N". */
  recorded: string;
}

/**
 * Words that mean the string is an ENTITY, not a person. An entity's name is
 * already in reading order and must never be reordered: "PACIFIC COAST TITLE
 * COMPANY" would become "COMPANY PACIFIC COAST TITLE".
 *
 * The v3 sources note promises exactly this ("entity names are unchanged"), so
 * it is a stated property of the document, not an implementation detail.
 */
const ENTITY_WORDS = new Set([
  'trust', 'trustee', 'trustees', 'tr', 'llc', 'l.l.c', 'inc', 'incorporated',
  'corp', 'corporation', 'company', 'co', 'lp', 'llp', 'ltd', 'partnership',
  'bank', 'association', 'assn', 'church', 'city', 'county', 'state',
  'foundation', 'fund', 'holdings', 'properties', 'investments', 'group',
  'estate', 'survivor', 'living', 'family', 'revocable',
]);

/** Suffixes that trail a person's name and must stay at the end. */
const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v', 'md', 'dds', 'esq']);

const titleCase = (w: string) =>
  w.length <= 1 ? w.toUpperCase() : w[0]!.toUpperCase() + w.slice(1).toLowerCase();

function looksLikeEntity(words: string[]): boolean {
  return words.some((w) => ENTITY_WORDS.has(w.toLowerCase().replace(/[.,]/g, '')));
}

/**
 * One recorded name in reading order.
 *
 * County vesting is recorded SURNAME FIRST: "CHRISTENSEN ELWOOD N" is Elwood N
 * Christensen. The transform is to move the first word to the end — but only
 * when the string is a person's name at all, and only when there is something
 * to move. Everything else is returned title-cased and otherwise untouched.
 */
export function readingOrder(recorded: string): string {
  const raw = recorded.trim().replace(/\s+/g, ' ');
  if (!raw) return '';
  const words = raw.split(' ');

  // An entity, a single word, or a name that already carries a comma
  // ("CHRISTENSEN, ELWOOD") is not reordered — the comma form is unambiguous
  // and handled below, the other two have nothing to reorder safely.
  if (looksLikeEntity(words)) return words.map(titleCase).join(' ');
  if (words.length < 2) return titleCase(raw);

  if (raw.includes(',')) {
    const [surname, rest] = raw.split(',', 2);
    const given = (rest ?? '').trim();
    if (!given) return titleCase(surname!.trim());
    return `${given.split(' ').map(titleCase).join(' ')} ${titleCase(surname!.trim())}`;
  }

  // A trailing suffix belongs after the surname: "CHRISTENSEN ELWOOD JR" is
  // Elwood Christensen Jr, not Jr Elwood Christensen.
  const last = words[words.length - 1]!.toLowerCase().replace(/[.,]/g, '');
  const suffix = SUFFIXES.has(last) ? words.pop()! : null;
  const surname = words.shift()!;
  const given = words;
  const parts = [...given.map(titleCase), titleCase(surname)];
  if (suffix) parts.push(titleCase(suffix));
  return parts.join(' ');
}

/**
 * The vested owners, split and put in reading order.
 *
 * SiteX gives one string with owners separated by a semicolon:
 * "CHRISTENSEN ELWOOD N; NODEL JUDITH K". An ampersand is also seen and is
 * NOT a separator we split on — "SMITH JOHN & MARY" is one vesting of two
 * people sharing a surname, and splitting it would invent "Mary" with no
 * surname at all.
 */
export function parseOwners(primaryOwner: string | null | undefined): ParsedOwner[] {
  const raw = (primaryOwner ?? '').trim();
  if (!raw) return [];
  return raw
    .split(';')
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((recorded) => ({ recorded, display: readingOrder(recorded) }));
}

// ─── Legal description ──────────────────────────────────────────────────────

export interface ParsedLegal {
  tract: string | null;
  lot: string | null;
  /** The whole string, always, exactly as recorded. */
  asRecorded: string;
}

/**
 * Tract and lot pulled out of the brief legal description.
 *
 * "TRACT # 14627 LOT 52" is the shape this payload uses. Plenty of parcels
 * carry something this cannot parse — metes and bounds, condominium airspace,
 * a rancho — and for those the tiles show an em dash while `asRecorded` still
 * prints the string in full. NOTHING is guessed: a legal description is a
 * statement about what land is being described, and a wrong lot number on a
 * title document is a different order of error from a missing one.
 */
export function parseLegal(
  legalDescription: string | null | undefined,
  /**
   * The structured fields, when the payload carries them — which it does.
   * SiteX sends TractNumber and LotNumber alongside the brief description, so
   * the regex below is the FALLBACK, not the primary path. Reading the string
   * first was how an early cut printed "Tract: NO" on every live profile.
   */
  structured?: { tractNumber: string | null; lotNumber: string | null } | null,
): ParsedLegal | null {
  const asRecorded = (legalDescription ?? '').trim().replace(/\s+/g, ' ');
  const tractGiven = structured?.tractNumber?.trim() || null;
  const lotGiven = structured?.lotNumber?.trim() || null;
  // Structured values alone are enough to render the tiles even when the
  // brief description is missing.
  if (!asRecorded && (tractGiven || lotGiven)) {
    return { tract: tractGiven, lot: lotGiven, asRecorded: '' };
  }
  if (!asRecorded) return null;
  if (tractGiven || lotGiven) {
    return { tract: tractGiven, lot: lotGiven, asRecorded };
  }
  // THE NUMBER WORD IS OPTIONAL AND VARIES. Two real payloads, two spellings:
  //   "TRACT # 14627 LOT 52"   (10523 Stonybrook, 24 Aug)
  //   "TRACT NO 6654 LOT 44"   (1358 5th St, both live profiles)
  // An earlier version accepted any word after TRACT and captured "NO" as the
  // tract number on every one of our own profiles — a confident wrong value on
  // a title document, found by running this against the stored payloads rather
  // than against the one sample in the mock.
  //
  // So: skip an optional #, NO, NO., NUMBER or NUM, and require the captured
  // value to contain a digit. A tract identifier that is purely alphabetic is
  // not one we recognise, and an em dash is the honest answer.
  const m = /\bTRACT\s*(?:#|NOS?\.?|NUMBERS?|NUMS?\.?)?\s*([A-Z0-9-]+)/i.exec(asRecorded);
  const tract = m && /\d/.test(m[1]!) ? m[1]! : null;
  // `LOT 52` but never the LOT inside `LOT SIZE`.
  const lot = /\bLOT\s*#?\s*(\d+[A-Z]?)\b/i.exec(asRecorded)?.[1] ?? null;
  return { tract, lot, asRecorded };
}

// ─── The land ───────────────────────────────────────────────────────────────

/** Lot size in acres. 43,560 sf to the acre. */
export function acres(lotSizeSqft: number | null | undefined): number | null {
  return typeof lotSizeSqft === 'number' && lotSizeSqft > 0 ? lotSizeSqft / 43_560 : null;
}

/**
 * What share of the lot the house covers, as a fraction.
 *
 * Only meaningful when both figures are present and the lot is the larger —
 * a building area exceeding the lot is either a multi-storey figure or bad
 * data, and printing "142% of lot" would be asserting something absurd with a
 * straight face.
 */
export function lotCoverage(buildingArea: number | null | undefined, lotSize: number | null | undefined): number | null {
  if (typeof buildingArea !== 'number' || typeof lotSize !== 'number') return null;
  if (buildingArea <= 0 || lotSize <= 0 || buildingArea > lotSize) return null;
  return buildingArea / lotSize;
}

/** Tax as a share of assessed value. */
export function taxShare(tax: NormalizedTax): number | null {
  if (typeof tax.taxAmount !== 'number' || typeof tax.assessedValue !== 'number') return null;
  if (tax.assessedValue <= 0 || tax.taxAmount <= 0) return null;
  return tax.taxAmount / tax.assessedValue;
}

// ─── Tax installments ───────────────────────────────────────────────────────

export interface Installment {
  label: 'First' | 'Second';
  amount: number | null;
  due: string;
  /**
   * The statutory date after which the instalment attracts a penalty.
   *
   * Named `lateAfter` rather than the county's own "delinquent after": the
   * document must not print the word "delinquent" anywhere, and a field name
   * that carries it invites a column header that does. The date itself is the
   * same for every California parcel and discloses nothing about an owner.
   */
  lateAfter: string;
}

/**
 * California's two statutory installments.
 *
 * THIS IS CALIFORNIA-ONLY, DELIBERATELY AND VISIBLY. The payload carries an
 * annual total and a status and nothing else, so the halves and the dates are
 * ours, not the county's — the document says so in a footnote, and this returns
 * null for any county outside California so the table can fall back to a single
 * annual row rather than print Californian dates over Nevada tax.
 *
 * Dates are the statute: first instalment due 1 November, delinquent after
 * 10 December; second due 1 February, delinquent after 10 April.
 */
export function californiaInstallments(tax: NormalizedTax, state: string | null | undefined): Installment[] | null {
  const st = (state ?? '').trim().toUpperCase();
  if (st !== 'CA' && st !== 'CALIFORNIA') return null;
  if (typeof tax.year !== 'number') return null;
  const half = typeof tax.taxAmount === 'number' && tax.taxAmount > 0 ? tax.taxAmount / 2 : null;
  const y = tax.year;
  return [
    { label: 'First', amount: half, due: `Nov 1, ${y}`, lateAfter: `Dec 10, ${y}` },
    { label: 'Second', amount: half, due: `Feb 1, ${y + 1}`, lateAfter: `Apr 10, ${y + 1}` },
  ];
}

// ─── Which layer page 4 can be built from ───────────────────────────────────
//
// Page 4 has three layers and the middle one has to be visible on the page.
//
//   1. TitlePoint's tax report — installments, exemption, special assessments,
//      bonds, supplementals. Everything the page was specified to show.
//   2. SiteX AssessmentTaxInfo — assessed value, the land/improvement split
//      and the annual amount. THINNER, and the page must say so and give an
//      as-of date, because otherwise a reader cannot tell why one profile
//      shows installments and another does not.
//   3. Neither — NO PAGE 4 AT ALL. Seven pages. Not an empty shell and not a
//      "not available" tile, which is the one thing the handoff rules out
//      twice.
//
// Verified against all three stored payloads: feed 100001 carries 2 of the 7
// fields page 4 needs (scripts/audit/concierge-tax-fields-available.ts), which
// is exactly layer 2 and is why layer 2 exists rather than being folded into
// layer 1 as a degraded case.

/** One statutory instalment as TitlePoint sends it — `Installments.Item`. */
export interface TaxReportInstallment {
  /** TitlePoint's own key: '1st' | '2nd'. Kept as sent rather than parsed. */
  number: string;
  amount: number | null;
  dueDate: string | null;
  /**
   * Stored, NEVER rendered. Payment status is blocked on the same privacy
   * reasoning as the delinquency fields — see TITLEPOINT_TAX_REPORT_ELEMENTS.md.
   * Kept on the type so a future ruling is a render change, not a re-pull.
   */
  status: string | null;
}

export interface TaxLineItem {
  description: string | null;
  amount: number | null;
  /** Bonds carry one and it is genuinely good content: "matures 2031". */
  maturityDate: string | null;
}

/**
 * TitlePoint's tax report, reduced to what a courtesy document may show.
 *
 * Tier 1 and Tier 2 of the classification only. The excluded families —
 * delinquency, tax sales, back taxes, and every protected-characteristic
 * exemption (senior, disabled, veteran, widow) — are absent from this type on
 * purpose: a field that is not here cannot be rendered by accident.
 */
export interface NormalizedTaxReport {
  taxYear: number | null;
  annualAmount: number | null;
  assessedValue: number | null;
  landValue: number | null;
  improvementValue: number | null;
  taxRate: number | null;
  taxRateArea: string | null;
  /** The only exemption that may appear. Never a category name. */
  homeOwnerExemption: number | null;
  installments: TaxReportInstallment[];
  specialAssessments: TaxLineItem[];
  bonds: TaxLineItem[];
  supplementals: TaxLineItem[];
  /**
   * The Community Facilities Districts this parcel sits in, and what they cost.
   *
   * SEPARATE FROM specialAssessments, which already contains these same lines.
   * It is not a second copy of the money — it is the disclosure's own data, and
   * the disclosure has to name the districts and state a combined figure, which
   * a flat list of line items cannot do.
   *
   * `total` IS PART OF THE ANNUAL AMOUNT, not additional to it. Measured: the
   * Liens block sums to TotalTax on 82.9% of Mello-Roos payloads, and the
   * rate-split reproduces TotalTax on every complete block. The wording on the
   * page depends on that and says "included in".
   */
  melloRoos: { districts: string[]; total: number } | null;
  /** RunDate / IssueDate. Mandatory on a document read weeks later. */
  asOf: string | null;
}

// ─── The Mello-Roos disclosure ──────────────────────────────────────────────
//
// WORDING IS JERRY'S, final 2026-10-01, and is reproduced here rather than
// paraphrased. It is a disclosure on a document a buyer reads, so it is not
// ours to improve — this function's whole job is to put his sentence together
// with the right number of districts in it.
//
// THREE THINGS IT IS CAREFUL ABOUT:
//
//   "special tax", never "fee" — that is its legal character, and "fee" invites
//   the question of whether it is negotiable.
//
//   "INCLUDED IN the annual property tax shown above". Measured, not assumed:
//   the Liens block sums to TotalTax on 82.9% of Mello-Roos payloads. An
//   earlier draft said "levied in addition to", which is true of the base tax
//   and would make a reader add the figure to a total that already contains it.
//
//   It does not predict when the term ends. The maturity date only arrives with
//   bond records, which are populated on 28 of 1,322 payloads and on NONE in
//   Riverside or San Bernardino, where the districts actually are. "Typically
//   20 to 40 years" would be true of the category, unverified for the parcel,
//   and quoted back at us.
//
// No "ad valorem": precise, and jargon. "The base property tax" says it.

const COUNT_WORDS = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

/** "A and B" / "A, B, and C" — the serial comma, because these are names. */
function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

/**
 * The disclosure, in three parts, or null when the parcel is in no district.
 *
 * ─── WHY IT IS NOT ONE STRING ───────────────────────────────────────────────
 *
 * The district names are the county's, verbatim, which means SCREAMING CAPS in
 * the middle of a sentence. The ruling is that the characters do not change and
 * the loudness is handled by styling — so the names have to be separable from
 * the prose to carry a style of their own. Returning one string would force the
 * document to find them again by substring, which breaks the moment a district
 * is called something that also appears in the sentence.
 *
 * `money` is passed in so this module stays free of the document's formatters.
 */
export interface MelloRoosDisclosure {
  /** Up to and including the colon, or the full stop when nothing is named. */
  lead: string;
  /** The county's strings, verbatim. Empty when none could be read. */
  names: string[];
  /** From "Special taxes totalling…" to the end. */
  body: string;
}

export function melloRoosDisclosure(
  mello: { districts: readonly string[]; total: number } | null | undefined,
  money: (n: number) => string,
): MelloRoosDisclosure | null {
  if (!mello || mello.total <= 0) return null;

  const n = mello.districts.length;
  // A district we could not name is still a district the parcel is in, so the
  // count comes from the LINES, not from the names we managed to read.
  const named = mello.districts.filter((d) => d.trim() !== '');
  const amount = money(mello.total);
  const complete = named.length === n && n > 0;

  if (n <= 1) {
    return {
      lead: complete ? 'This parcel lies within a Community Facilities District:' : 'This parcel lies within a Community Facilities District.',
      names: complete ? [named[0]!] : [],
      body: `A special tax of ${amount} is included in the annual property tax shown above, in addition to the base property tax. `
        + 'These districts fund local infrastructure and services such as schools, roads and utilities, and the special tax runs for a fixed term set when the district was formed. '
        + 'The county tax collector can confirm the term and current balance.',
    };
  }

  const count = COUNT_WORDS[n] ?? String(n);
  return {
    lead: complete
      ? `This parcel lies within ${count} Community Facilities Districts:`
      : `This parcel lies within ${count} Community Facilities Districts.`,
    names: complete ? [...named] : [],
    body: `Special taxes totalling ${amount} are included in the annual property tax shown above, in addition to the base property tax. `
      + 'These districts fund local infrastructure and services such as schools, roads and utilities, and each special tax runs for a fixed term set when its district was formed. '
      + 'The county tax collector can confirm the term and current balance.',
  };
}

/**
 * The same thing as one string, for assertions and any caller with nowhere to
 * put a second style. The serial comma lives here because it is punctuation
 * between names, not part of a name.
 */
export function melloRoosText(d: MelloRoosDisclosure | null): string | null {
  if (!d) return null;
  return d.names.length > 0
    ? `${d.lead} ${joinNames(d.names)}. ${d.body}`
    : `${d.lead} ${d.body}`;
}

export type TaxLayer =
  | { source: 'titlepoint'; report: NormalizedTaxReport }
  | { source: 'sitex'; tax: NormalizedTax; installments: Installment[] | null }
  | null;

/**
 * Pick the best layer available, or null for no page at all.
 *
 * A layer counts as present only when it carries a figure somebody would read.
 * A tax record that is all nulls is not a tax record — rendering a page of em
 * dashes is the empty shell the handoff rules out, and it looks identical to a
 * page whose data simply has not arrived yet.
 */
export function resolveTaxLayer(
  tax: NormalizedTax,
  state: string | null | undefined,
  report?: NormalizedTaxReport | null,
): TaxLayer {
  if (report && taxReportHasContent(report)) {
    return { source: 'titlepoint', report };
  }
  if (siteXTaxHasContent(tax)) {
    return { source: 'sitex', tax, installments: californiaInstallments(tax, state) };
  }
  return null;
}

/** At least one figure a reader would look for. Not merely a non-null object. */
export function taxReportHasContent(r: NormalizedTaxReport): boolean {
  return num(r.annualAmount) || num(r.assessedValue) || num(r.landValue)
    || num(r.improvementValue) || r.installments.length > 0
    || r.specialAssessments.length > 0 || r.bonds.length > 0 || r.supplementals.length > 0;
}

/**
 * The SiteX layer needs a figure too.
 *
 * `year` alone does NOT qualify: every payload carries a TaxYear, so treating
 * it as content would make this function return true for every profile and
 * layer 3 unreachable — the page would always render, empty, which is the
 * failure this is here to prevent.
 */
export function siteXTaxHasContent(tax: NormalizedTax): boolean {
  return num(tax.taxAmount) || num(tax.assessedValue) || num(tax.landValue) || num(tax.improvementValue);
}

const num = (v: number | null | undefined): boolean => typeof v === 'number' && Number.isFinite(v) && v > 0;

// ─── Transfers ──────────────────────────────────────────────────────────────

export interface TransferCounts {
  deeds: number;
  mortgages: number;
  releasesAndAssignments: number;
  foreclosure: number;
  total: number;
}

const kindOf = (t: NormalizedTransfer): keyof Omit<TransferCounts, 'total'> | null => {
  if (t.isForeclosure) return 'foreclosure';
  const v = `${t.transactionType ?? ''} ${t.documentType ?? ''}`.toLowerCase();
  if (v.includes('foreclosure')) return 'foreclosure';
  if (v.includes('deed') || v.includes('transfer')) return 'deeds';
  if (v.includes('mortgage') || v.includes('loan')) return 'mortgages';
  if (v.includes('release') || v.includes('assignment')) return 'releasesAndAssignments';
  return null;
};

/**
 * The four counts on page 4. `total` is every record, including any this
 * cannot classify — so the four tiles need not sum to it, and the page says
 * "13 documents" from `total` rather than from the sum of what it recognised.
 */
export function transferCounts(transfers: readonly NormalizedTransfer[]): TransferCounts {
  const c: TransferCounts = { deeds: 0, mortgages: 0, releasesAndAssignments: 0, foreclosure: 0, total: transfers.length };
  for (const t of transfers) {
    const k = kindOf(t);
    if (k) c[k] += 1;
  }
  return c;
}

/**
 * The deed current ownership rests on.
 *
 * "The latest deed" does not resolve the real payload: 10523 Stonybrook has
 * THREE records recorded on 19 March 2014, two of them deeds (14-0273394 and
 * 14-0273393). Picking by date alone would be a coin toss that changes between
 * runs if the vendor's ordering changes.
 *
 * So the rule is stated and stable: among transfers that are deeds and carry
 * `currentOwnerFlag`, take the most recent recording date; break a tie on the
 * HIGHEST document number, which is the later recording within the same day;
 * and break a remaining tie on the earliest source position, so the answer is
 * deterministic even when the vendor gives us nothing to separate them.
 */
export function currentVestingDeed(transfers: readonly NormalizedTransfer[]): NormalizedTransfer | null {
  const deeds = transfers.filter((t) => kindOf(t) === 'deeds' && t.currentOwnerFlag !== false);
  if (deeds.length === 0) return null;
  const rank = (t: NormalizedTransfer) => ({
    date: t.recordingDate ?? '',
    doc: t.documentNumber ?? '',
    pos: t.sourcePosition,
  });
  return [...deeds].sort((a, b) => {
    const x = rank(a), y = rank(b);
    if (x.date !== y.date) return x.date < y.date ? 1 : -1;
    if (x.doc !== y.doc) return x.doc < y.doc ? 1 : -1;
    return x.pos - y.pos;
  })[0]!;
}

// ─── The comparable range ───────────────────────────────────────────────────

export interface CompRange {
  /** Lowest and highest price-per-square-foot among the SELECTED comps. */
  minPerSqft: number;
  maxPerSqft: number;
  medianPerSqft: number | null;
  /** Subject area × each of the above. Null when the subject has no area. */
  low: number | null;
  high: number | null;
  midpoint: number | null;
  basedOn: number;
}

/**
 * The page 1 and page 6 range.
 *
 * NOT `metrics.priceRangeMin/Max` — those are SALE PRICES, and using them here
 * would print a plausible number under a label that means something else. The
 * range is the subject's own area priced at the comparables' cheapest and
 * dearest rate, which is why it is computed from the per-comp rates.
 *
 * Returns null unless at least two comps carry a usable rate: a "range" from
 * one sale is not a range, and printing one would overstate what five sales —
 * let alone one — can support.
 */
export function compRange(
  filter: CompFilterResult,
  subject: NormalizedSubject,
  medianPerSqft: number | null,
): CompRange | null {
  const rates = filter.selected
    .map((c) => c.pricePerSqft)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0);
  if (rates.length < 2) return null;

  const minPerSqft = Math.min(...rates);
  const maxPerSqft = Math.max(...rates);
  const area = typeof subject.buildingArea === 'number' && subject.buildingArea > 0 ? subject.buildingArea : null;

  return {
    minPerSqft,
    maxPerSqft,
    medianPerSqft,
    low: area ? area * minPerSqft : null,
    high: area ? area * maxPerSqft : null,
    midpoint: area && typeof medianPerSqft === 'number' ? area * medianPerSqft : null,
    basedOn: rates.length,
  };
}
