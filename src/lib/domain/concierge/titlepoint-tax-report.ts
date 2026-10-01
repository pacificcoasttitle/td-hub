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
    /** Composed from land + improvements and it reconciles. */
    | 'verified'
    /** Composed, but rate or annual amount is missing, so it cannot be checked. */
    | 'unverifiable'
    /** Composed and it does NOT reconcile. The interesting case. */
    | 'mismatch'
    /** No land/improvement split to compose from. */
    | 'absent';
  /** What the identity predicts the annual tax would be, for the record. */
  expectedTax: number | null;
  /** What TitlePoint says it is. */
  statedTax: number | null;
}

/**
 * Tolerance: half a percent, with a dollar floor so a small bill is not held to
 * a stricter standard than a large one. At this setting 97.9% of the 1,247
 * checkable payloads pass, and the median error is zero.
 */
function reconciles(expected: number, stated: number): boolean {
  return Math.abs(expected - stated) <= Math.max(1, stated * 0.005);
}

export function reconcileAssessedTotal(input: {
  stated: number | null;
  landValue: number | null;
  improvementValue: number | null;
  homeOwnerExemption: number | null;
  taxRate: number | null;
  annualAmount: number | null;
}): AssessedReconciliation {
  const { stated, landValue, improvementValue, homeOwnerExemption, taxRate, annualAmount } = input;

  if (stated !== null) {
    return { total: stated, basis: 'stated', expectedTax: null, statedTax: annualAmount };
  }
  if (landValue === null || improvementValue === null) {
    return { total: null, basis: 'absent', expectedTax: null, statedTax: annualAmount };
  }

  const composed = landValue + improvementValue;
  if (taxRate === null || annualAmount === null) {
    return { total: null, basis: 'unverifiable', expectedTax: null, statedTax: annualAmount };
  }

  const taxable = composed - (homeOwnerExemption ?? 0);
  const expectedTax = taxable * (taxRate / 100);
  return reconciles(expectedTax, annualAmount)
    ? { total: composed, basis: 'verified', expectedTax, statedTax: annualAmount }
    : { total: null, basis: 'mismatch', expectedTax, statedTax: annualAmount };
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

  // The sum, not a vendor field — and only when it reconciles against the tax
  // the county billed. See the docblock: verified, not merely computed.
  const assessed = reconcileAssessedTotal({
    stated: positive(r.AssessedValuation ?? r.assessedValuation),
    landValue, improvementValue, homeOwnerExemption, taxRate, annualAmount,
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
    // `Liens`, because SpecialAssessments is empty on every payload we hold.
    specialAssessments: items(obj(r, 'Liens'))
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
