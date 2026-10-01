import type { NormalizedTaxReport, TaxLineItem, TaxReportInstallment } from './document/derive';

// ─── TitlePoint's tax report → what page 4 may show ─────────────────────────
//
// Layer 1 of the three-layer fallback. Built against 58 real stored payloads
// (scripts/audit/concierge-tax-report-shape.ts), not against a field list in a
// document, and the counts below are from those 58.
//
// WHAT THE ENDPOINT ACTUALLY CARRIES, which differs from what was assumed:
//
//   TaxYear                58/58   and it is "2026-2027", a RANGE, not a number
//   TotalTax               56/58   "13,387.35" — thousands separators
//   LandValuation          56/58
//   ImprovementsValuation  52/58
//   TaxRate                55/58   "1.409829" — a percentage
//   TaxRateArea            58/58   "07792", "07-095", "007-010" — never numeric
//   RunDate                58/58   "9/30/2026" — M/D/YYYY
//   HomeOwnerExemption     14/58   key ABSENT when there is none
//   Installments.Item[]    58/58   two per report, DueDate on all 116
//   Liens.Item[]           55/58   the direct assessments — see below
//   AssessedValuation       0/58   EMPTY STRING on every single payload
//   Bonds                   0/58   empty string on every payload
//   SpecialAssessments      0/58   empty; CountSpecialAssessments is "0" on all 58
//
// ─── ASSESSED VALUE IS COMPOSED, AND THE ARITHMETIC IS A GUARD ──────────────
//
// AssessedValuation is "" on all 58, so layer 1 has no total to print. It is
// land + improvements — and rather than trust that, every profile re-derives it
// and checks it against the tax the county actually billed:
//
//     (land + improvements - homeOwnerExemption) x TaxRate/100  ==  TotalTax
//
// Measured over all 1,322 stored tax payloads: 1,247 carry all four parts, and
// of those the identity holds to within ONE CENT on 90%, within 0.5% on 97.9%,
// with a median error of exactly $0.00. It is not an approximation that happens
// to work on one property; it is how a California tax bill is computed.
//
// So the composition is only used WHEN IT RECONCILES. When it does not, the page
// prints land and improvements and no total. That turns a computed figure into a
// verified one and makes the failure mode a gap rather than a confident wrong
// number on a document with our name on it. It fires on about 2% of payloads.
//
// A total we CANNOT check is suppressed too, not just one that fails the check —
// same risk, and the only reason to treat them differently would be to show the
// figure more often, which is the wrong thing to optimise on a document.
//
// The total is never taken from SiteX here: page 4 names its layer, and a figure
// quietly borrowed from the other vendor would make that label a lie.
//
// ─── "SPECIAL ASSESSMENTS" LIVE IN `Liens` ──────────────────────────────────
//
// The field named SpecialAssessments is empty on every payload and
// CountSpecialAssessments is "0" on every payload. The content is in `Liens`:
// "LOS ANGELES COUNTY TRAUMA/EMERG SRVS · 277.07", "SAFE CLEAN WATER",
// "LOS ANGELES COUNTY FLOOD CONTROL", "REGIONAL PARK AND OPEN SPACE DISTRICT".
// Those are the direct assessments on a California tax bill, which is what the
// spec meant, so they map to `specialAssessments`.
//
// Each item carries exactly five keys — Account, Amount, Description, Rate,
// IsMelloRoos — and NO status, payment or delinquency field, so nothing from the
// excluded families can arrive through this door. `IsMelloRoos` is true on 3 of
// 58; it is parsed and deliberately NOT rendered as a badge, because "this
// property is in a Mello-Roos district" is a disclosure and a disclosure is
// Jerry's to word, not a flag this module can promote on its own.
//
// ─── WHAT IS DELIBERATELY NOT READ ──────────────────────────────────────────
//
// DelinquencyInformation is on 58/58 of these payloads, DelinquencyInstallments
// on 14, RedemptionSchedules on 14, OpenPriorYears on 16. The exclusion of those
// families is therefore load-bearing rather than theoretical — the data is right
// there in the response every time. This module reads none of them, and the
// return type has no slot for them, so rendering one would require adding a
// field and not merely forgetting a guard.
//
// The same reasoning is why callers should store THIS, not the raw payload, on a
// profile: the raw already has a governed home in title_point_data.

/** "13,387.35" → 13387.35. Empty, "0.00" and unparseable all become null. */
function money(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const cleaned = v.replace(/[$,\s]/g, '').trim();
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * A figure that is zero is a real figure for a lien and a non-figure for a
 * valuation, so zero is kept here and filtered by the caller that cares.
 */
function positive(v: unknown): number | null {
  const n = money(v);
  return n !== null && n > 0 ? n : null;
}

/**
 * "2026-2027" → 2026. The leading group only.
 *
 * Number("2026-2027") is NaN and parseFloat("2026-2027") is 2026 by accident of
 * where it stops; neither is a thing to depend on. The document renders the
 * range itself from this number (fiscalYear), so returning the first year is
 * both what the type says and what page 4 prints back.
 */
function leadingYear(v: unknown): number | null {
  const m = /(\d{4})/.exec(String(v ?? ''));
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1900 && n <= 2200 ? n : null;
}

/** "9/30/2026" → "2026-09-30". Anything else is returned untouched. */
function isoDate(v: unknown): string | null {
  const s = String(v ?? '').trim();
  if (s === '') return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (!m) return s;
  const [, mo, d, y] = m;
  // 1/1/0001 is TitlePoint's "no date"; the year guard above lets it through as
  // a string, so it is rejected here where the shape is known.
  if (y === '0001') return null;
  return `${y}-${mo!.padStart(2, '0')}-${d!.padStart(2, '0')}`;
}

function obj(o: unknown, key: string): Record<string, unknown> | null {
  if (!o || typeof o !== 'object') return null;
  const v = (o as Record<string, unknown>)[key];
  return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
}

/**
 * `Item` is an object when there is one and an array when there are several.
 *
 * This is not a quirk worth a comment anywhere else, except that getting it
 * wrong is silent: a single-item block read as an array yields nothing, and the
 * page loses a row rather than failing. Supplementals is an object on 2 of the 5
 * payloads that have it and an array on the rest.
 */
function items(block: Record<string, unknown> | null): Record<string, unknown>[] {
  if (!block) return [];
  const raw = block.Item ?? block.item;
  if (Array.isArray(raw)) return raw.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object');
  return raw && typeof raw === 'object' ? [raw as Record<string, unknown>] : [];
}

const str = (v: unknown): string | null => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};

/** One direct assessment. Described and priced; nothing else is read. */
function lineItem(o: Record<string, unknown>): TaxLineItem | null {
  const description = str(o.Description ?? o.description ?? o.DueToDescription);
  const amount = money(o.Amount ?? o.amount ?? o.TotalInstallmentBalance);
  if (!description && amount === null) return null;
  return { description, amount, maturityDate: isoDate(o.MaturityDate ?? o.maturityDate) };
}

// ─── `Liens` is not a list of special assessments ───────────────────────────
//
// On about half the payloads (631 of 1,282) the Liens block sums to TotalTax:
// it is the WHOLE BILL, line by line, and that includes the ad valorem levies.
// Riverside #4840 opens with "GENERAL PURPOSE $5,203.70" at rate 1.000000 —
// the base 1% — followed by "HEMET UNIFIED SCHOOL B & I" at 0.12%. San
// Bernardino #4553 calls the same thing "ZZSECURED". Printing those under
// "special assessments" tells a homeowner their base property tax is a special
// assessment, on 16.1% of parcels.
//
// `Rate` IS THE DISCRIMINATOR, and it is exact. A line with a rate is a
// percentage of assessed value and is already inside the annual figure's rate;
// a line at 0.000000 is a fixed-dollar charge levied per parcel — Mello-Roos,
// parcel taxes, vector control, sewer. Splitting on it and summing the two
// halves reproduces TotalTax on 639 of 639 payloads where the block is
// complete. Every Mello-Roos line observed is in the rate-0 half.

const rateOf = (o: Record<string, unknown>): number => money(o.Rate ?? o.rate) ?? 0;

/** Fixed-dollar charges only — what "direct assessment" means on a CA bill. */
const isDirectAssessment = (o: Record<string, unknown>): boolean => rateOf(o) === 0;

/**
 * The base ad valorem levy line, if the county itemises one.
 *
 * Its amount over its rate is the net assessed value the COUNTY used, which is
 * the only independent check available on our composed total — see
 * reconcileAssessedTotal.
 */
function baseLevyOf(liens: readonly Record<string, unknown>[]): { amount: number; rate: number } | null {
  for (const l of liens) {
    const rate = rateOf(l);
    const amount = money(l.Amount ?? l.amount);
    // The 1% constitutional base. Bounded rather than exact because a county
    // may carry it as 1.000000 or 0.010000 scaled differently; only the former
    // has been observed, and a wider net would catch a school bond.
    if (amount !== null && rate >= 0.99 && rate <= 1.01) return { amount, rate };
  }
  return null;
}

function installment(o: Record<string, unknown>): TaxReportInstallment | null {
  const number = str(o.Number ?? o.number);
  const amount = money(o.Amount ?? o.amount);
  const dueDate = isoDate(o.DueDate ?? o.dueDate);
  if (!number && amount === null && !dueDate) return null;
  return {
    number: number ?? '',
    amount,
    dueDate,
    // Stored, never rendered. See derive.ts.
    status: str(o.Status ?? o.status),
  };
}

/**
 * How the assessed total was arrived at, and whether it may be printed.
 *
 * Returned separately from the report so the bridge can record WHY a total was
 * suppressed. On the page the reader sees only the absence — an explanation of
 * our own arithmetic is not something a client should have to read — but a
 * suppression nobody can account for later is how a real vendor problem gets
 * filed as a rendering quirk.
 */
export interface AssessedReconciliation {
  /** Printable only when non-null. Null means the page shows no total. */
  total: number | null;
  basis:
    /** The vendor stated a total; no arithmetic of ours involved. */
    | 'stated'
    /** Composed, and the county's own base levy line confirms it. */
    | 'levy'
    /** Composed. Nothing independent to check it against on this payload. */
    | 'composed'
    /** The base levy line CONTRADICTS the composition. Suppressed. */
    | 'mismatch'
    /** No land/improvement split to compose from. */
    | 'absent';
  /** Net assessed value implied by the base levy line, where there is one. */
  impliedNet: number | null;
  /** The composition's own net, for comparison. */
  composedNet: number | null;
}

/**
 * ─── THE CHECK THAT IS NOT CIRCULAR ─────────────────────────────────────────
 *
 * The first version of this verified the composition with
 *
 *     (land + improvements - exemption) x TaxRate/100  ==  TotalTax
 *
 * and reported that it held to the cent on 90% of payloads, which it does —
 * because TAXRATE IS DERIVED FROM TOTALTAX. Measured: TaxRate equals
 * TotalTax / net x 100 to five decimal places on 1,240 of 1,282 payloads
 * (96.7%). The identity was an identity. It could not fail, so it confirmed
 * nothing, and the word "verified" on the result was wrong.
 *
 * What IS independent: on counties that itemise the bill, `Liens` carries the
 * base ad valorem levy as its own line at a ~1% rate — "GENERAL PURPOSE",
 * "ZZSECURED". That line's amount divided by its rate gives the net assessed
 * value the COUNTY used, from a different field than the one we composed. It
 * agrees with land + improvements - exemption on 204 of the 207 payloads where
 * both are parseable, usually to the dollar.
 *
 * So: where that line exists, it decides. Where it does not, the total is still
 * composed and printed — the rule is confirmed at 98.6% wherever it can be
 * checked, and suppressing the figure on the 84% of parcels that happen not to
 * itemise would discard a correct number to avoid an unprovable one. The basis
 * records which case this was, so nobody later mistakes 'composed' for checked.
 */
function agrees(implied: number, composed: number): boolean {
  // A few dollars, or 0.2%. The disagreements are not near-misses: they are
  // either exact or out by a different parcel's worth.
  return Math.abs(implied - composed) <= Math.max(5, composed * 0.002);
}

export function reconcileAssessedTotal(input: {
  stated: number | null;
  landValue: number | null;
  improvementValue: number | null;
  homeOwnerExemption: number | null;
  /** The ~1% base ad valorem line from Liens, when the county itemises. */
  baseLevy: { amount: number; rate: number } | null;
}): AssessedReconciliation {
  const { stated, landValue, improvementValue, homeOwnerExemption, baseLevy } = input;

  if (stated !== null) {
    return { total: stated, basis: 'stated', impliedNet: null, composedNet: null };
  }
  if (landValue === null || improvementValue === null) {
    return { total: null, basis: 'absent', impliedNet: null, composedNet: null };
  }

  const composed = landValue + improvementValue;
  const composedNet = composed - (homeOwnerExemption ?? 0);

  if (!baseLevy || baseLevy.rate <= 0) {
    return { total: composed, basis: 'composed', impliedNet: null, composedNet };
  }

  const impliedNet = baseLevy.amount / (baseLevy.rate / 100);
  return agrees(impliedNet, composedNet)
    ? { total: composed, basis: 'levy', impliedNet, composedNet }
    : { total: null, basis: 'mismatch', impliedNet, composedNet };
}

export interface ParsedTaxResult {
  report: NormalizedTaxReport;
  /** Why the assessed total is there, or is not. Recorded, never rendered. */
  assessed: AssessedReconciliation;
}

/**
 * Parse a stored TitlePoint tax `resultData` into the report page 4 may show.
 *
 * Returns null when the payload is not a tax result at all. A tax result that
 * simply carries no figures comes back as a report with nothing in it —
 * `taxReportHasContent()` is what decides whether that is worth a page, and
 * keeping those two judgements apart is deliberate: "could not parse" and "the
 * county has nothing" are different answers and the caller records them
 * differently.
 */
export function parseTitlePointTaxResult(resultData: unknown): ParsedTaxResult | null {
  if (!resultData || typeof resultData !== 'object' || Array.isArray(resultData)) return null;

  const rd = resultData as Record<string, unknown>;
  const r = obj(rd, 'TaxReport') ?? obj(rd, 'taxReport');
  if (!r) return null;

  const landValue = positive(r.LandValuation ?? r.landValuation);
  const improvementValue = positive(r.ImprovementsValuation ?? r.improvementsValuation);
  const taxRate = positive(r.TaxRate ?? r.taxRate);
  const annualAmount = positive(r.TotalTax ?? r.totalTax);
  const homeOwnerExemption = positive(r.HomeOwnerExemption ?? r.homeOwnerExemption);

  const liens = items(obj(r, 'Liens'));

  // The sum, not a vendor field — checked against the county's own base levy
  // line where there is one. See reconcileAssessedTotal for why the previous
  // check, against TaxRate, could not fail.
  const assessed = reconcileAssessedTotal({
    stated: positive(r.AssessedValuation ?? r.assessedValuation),
    landValue, improvementValue, homeOwnerExemption,
    baseLevy: baseLevyOf(liens),
  });

  const report: NormalizedTaxReport = {
    taxYear: leadingYear(r.TaxYear ?? r.taxYear),
    annualAmount,
    assessedValue: assessed.total,
    landValue,
    improvementValue,
    taxRate,
    taxRateArea: str(r.TaxRateArea ?? r.taxRateArea),
    homeOwnerExemption,
    installments: items(obj(r, 'Installments'))
      .map(installment)
      .filter((x): x is TaxReportInstallment => x !== null),
    // `Liens`, because SpecialAssessments is empty on every payload we hold —
    // but ONLY its fixed-dollar lines. The rate-bearing ones are ad valorem
    // and belong to the annual figure, not beside it.
    specialAssessments: liens
      .filter(isDirectAssessment)
      .map(lineItem)
      .filter((x): x is TaxLineItem => x !== null),
    bonds: items(obj(r, 'Bonds'))
      .map(lineItem)
      .filter((x): x is TaxLineItem => x !== null),
    supplementals: items(obj(r, 'Supplementals'))
      .map(lineItem)
      .filter((x): x is TaxLineItem => x !== null),
    asOf: isoDate(r.RunDate ?? r.runDate) ?? isoDate(r.IssueDate ?? r.issueDate),
  };

  return { report, assessed };
}

/** The report alone, for callers with nothing to record. */
export function parseTitlePointTaxReport(resultData: unknown): NormalizedTaxReport | null {
  return parseTitlePointTaxResult(resultData)?.report ?? null;
}

/**
 * Whether a lien line is a Mello-Roos district charge.
 *
 * PARSED AND NOT RENDERED, on purpose. True on 3 of 58 payloads. Saying "this
 * property is in a Mello-Roos district" on a document a buyer reads is a
 * disclosure, and the wording of disclosures on this document is Jerry's. This
 * exists so that when he rules on it the change is a render, not another pull.
 */
export function melloRoosLines(resultData: unknown): string[] {
  const rd = resultData && typeof resultData === 'object' ? resultData as Record<string, unknown> : {};
  const r = obj(rd, 'TaxReport');
  return items(obj(r, 'Liens'))
    .filter((o) => String(o.IsMelloRoos ?? '').toLowerCase() === 'true')
    .map((o) => str(o.Description) ?? '')
    .filter((s) => s !== '');
}

/**
 * The Mello-Roos special tax for this parcel, in dollars.
 *
 * ─── IT IS ALREADY INSIDE THE ANNUAL AMOUNT ─────────────────────────────────
 *
 * Measured, because the disclosure wording turns on it: on 97 of the 117
 * Mello-Roos payloads (82.9%) the Liens block sums to TotalTax, and the
 * rate-split reproduces TotalTax on every complete block. So the special tax is
 * a line INSIDE the figure page 4 prints as the annual amount, not something a
 * reader should add to it.
 *
 * That is the opposite of what "levied in addition to the base property tax"
 * invites, which is why it is worth a function rather than a comment.
 */
export function melloRoosTotal(resultData: unknown): number | null {
  const rd = resultData && typeof resultData === 'object' ? resultData as Record<string, unknown> : {};
  const r = obj(rd, 'TaxReport');
  const lines = items(obj(r, 'Liens'))
    .filter((o) => String(o.IsMelloRoos ?? '').toLowerCase() === 'true');
  if (lines.length === 0) return null;
  const sum = lines.reduce((a, o) => a + (money(o.Amount ?? o.amount) ?? 0), 0);
  return sum > 0 ? sum : null;
}
