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
// ─── ASSESSED VALUE IS COMPOSED, and the arithmetic proves it ───────────────
//
// AssessedValuation is "" on all 58, so layer 1 has no total to print. It is
// land + improvements, which is checkable rather than assumed: on the most
// recent payload land 470,999 + improvements 485,573 = 956,572; minus the 7,000
// homeowner exemption is 949,572; at the stated rate of 1.409829% that is
// 13,387.60 against a stated TotalTax of 13,387.35. The composition and the
// exemption's role both fall out of that to within a rounding.
//
// So `assessedValue` is the sum when both parts are present, and null when
// either is missing. It is never taken from SiteX here — page 4 says which
// layer it is on, and a total quietly borrowed from the other vendor would make
// that label a lie.
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
 * Parse a stored TitlePoint tax `resultData` into the report page 4 may show.
 *
 * Returns null when the payload is not a tax result at all. A tax result that
 * simply carries no figures comes back as a report with nothing in it —
 * `taxReportHasContent()` is what decides whether that is worth a page, and
 * keeping those two judgements apart is deliberate: "could not parse" and "the
 * county has nothing" are different answers and the caller records them
 * differently.
 */
export function parseTitlePointTaxReport(resultData: unknown): NormalizedTaxReport | null {
  if (!resultData || typeof resultData !== 'object' || Array.isArray(resultData)) return null;

  const rd = resultData as Record<string, unknown>;
  const r = obj(rd, 'TaxReport') ?? obj(rd, 'taxReport');
  if (!r) return null;

  const landValue = positive(r.LandValuation ?? r.landValuation);
  const improvementValue = positive(r.ImprovementsValuation ?? r.improvementsValuation);

  // The sum, not a vendor field: AssessedValuation is empty on all 58 payloads.
  // Both halves or nothing — a "total" that is really just the land would read
  // as an assessed value and be wrong by the size of the house.
  const stated = positive(r.AssessedValuation ?? r.assessedValuation);
  const assessedValue = stated
    ?? (landValue !== null && improvementValue !== null ? landValue + improvementValue : null);

  return {
    taxYear: leadingYear(r.TaxYear ?? r.taxYear),
    annualAmount: positive(r.TotalTax ?? r.totalTax),
    assessedValue,
    landValue,
    improvementValue,
    taxRate: positive(r.TaxRate ?? r.taxRate),
    taxRateArea: str(r.TaxRateArea ?? r.taxRateArea),
    homeOwnerExemption: positive(r.HomeOwnerExemption ?? r.homeOwnerExemption),
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
