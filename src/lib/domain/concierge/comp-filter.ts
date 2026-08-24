// ─── Comparable selection ────────────────────────────────────────────────────
//
// Pure. No I/O, no dates from the ambient clock (the caller passes `asOf`), no
// database. Given the full returned comp set and a set of criteria, it decides
// which comparables the report shows and why each of the others was dropped.
//
// WHY THIS IS ITS OWN MODULE.
//
// SiteX accepts comp_* options and silently ignores them on our feed — proven
// with a control: identical byte-for-byte comp arrays whether or not the policy
// was sent. So the filtering is ours to do, and if it is ours to do it must be
// testable in isolation.
//
// TWO RULES THIS MODULE EXISTS TO ENFORCE:
//
//   1. NEVER PAD TO REACH THE TARGET. maxComps is a ceiling, not a quota. If
//      seven comparables qualify, seven are shown. The legacy report loosened
//      its filters until it hit a count and then printed the ORIGINAL criteria,
//      which is how it came to describe filters it never applied.
//
//   2. THE CRITERIA COME OUT OF HERE. The report prints `result.criteria` —
//      the values that were applied — never anything recomputed from the
//      selected set. Deriving "search radius" from the comps you happened to
//      get is how a 0.5-mile policy prints as 0.96 miles.

/** One comparable as SiteX returns it, narrowed to what selection needs. */
export interface CompCandidate {
  sourcePosition: number;
  salePrice: number | null;
  /** SiteX's own PricePerSQFT. Never recomputed here. */
  pricePerSqft: number | null;
  buildingArea: number | null;
  bedrooms: number | null;
  baths: number | null;
  yearBuilt: number | null;
  lotSize: number | null;
  proximityMiles: number | null;
  recordingDate: string | null;
  useCodeDescription: string | null;
}

export interface SubjectFacts {
  buildingArea: number | null;
  bedrooms: number | null;
  baths: number | null;
  useCodeDescription: string | null;
}

export interface CompCriteria {
  sameUseCode: boolean;
  /** Percent tolerance on living area, e.g. 30 => within ±30%. */
  livingAreaPct: number | null;
  bedDelta: number | null;
  bathDelta: number | null;
  radiusMiles: number | null;
  months: number | null;
  /** Ceiling on how many are shown. NOT a quota. */
  maxComps: number;
}

export const DEFAULT_CRITERIA: CompCriteria = {
  sameUseCode: true,
  livingAreaPct: 30,
  bedDelta: 1,
  bathDelta: 1,
  radiusMiles: 1,
  months: 12,
  maxComps: 12,
};

/**
 * Why a comparable was dropped. Stored per row so a challenged comp can be
 * explained months later. Order here is the order rules are applied.
 */
export const EXCLUSION_REASONS = [
  'no_sale_price',
  'use_code',
  'sale_too_old',
  'outside_radius',
  'living_area',
  'bedrooms',
  'bathrooms',
  'over_max',
] as const;
export type ExclusionReason = (typeof EXCLUSION_REASONS)[number];

export interface CompDecision {
  candidate: CompCandidate;
  selected: boolean;
  exclusionReason: ExclusionReason | null;
  /** 1-based rank among selected comps, as printed. Null when not selected. */
  displayPosition: number | null;
}

export interface CompFilterResult {
  decisions: CompDecision[];
  selected: CompCandidate[];
  /** The criteria APPLIED. The report prints these. */
  criteria: CompCriteria;
  counts: {
    /** Everything SiteX returned. */
    returned: number;
    /** How many passed every rule — may exceed what is shown. */
    qualified: number;
    /** How many the report shows. <= qualified, <= maxComps. */
    shown: number;
  };
}

function monthsBetween(fromIso: string, asOf: Date): number | null {
  const d = new Date(fromIso);
  if (Number.isNaN(d.getTime())) return null;
  return (asOf.getFullYear() - d.getFullYear()) * 12
    + (asOf.getMonth() - d.getMonth())
    + (asOf.getDate() >= d.getDate() ? 0 : -1);
}

function withinPct(value: number, reference: number, pct: number): boolean {
  if (reference <= 0) return false;
  return Math.abs(value - reference) / reference <= pct / 100;
}

/** Normalized use-code comparison — SiteX casing is inconsistent. */
function sameUse(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Decide which comparables the report shows.
 *
 * A candidate that fails ANY rule is excluded and carries the FIRST rule it
 * failed, so the reason is deterministic rather than dependent on evaluation
 * order between runs.
 */
export function selectComps(
  candidates: CompCandidate[],
  subject: SubjectFacts,
  criteria: CompCriteria,
  asOf: Date,
): CompFilterResult {
  const decisions: CompDecision[] = [];

  for (const c of candidates) {
    let reason: ExclusionReason | null = null;

    // A comparable with no sale price cannot support a price comparison.
    if (reason === null && (c.salePrice === null || c.salePrice <= 0)) reason = 'no_sale_price';

    if (reason === null && criteria.sameUseCode
      && !sameUse(c.useCodeDescription, subject.useCodeDescription)) reason = 'use_code';

    if (reason === null && criteria.months !== null) {
      if (!c.recordingDate) reason = 'sale_too_old';
      else {
        const age = monthsBetween(c.recordingDate, asOf);
        if (age === null || age > criteria.months || age < 0) reason = 'sale_too_old';
      }
    }

    if (reason === null && criteria.radiusMiles !== null) {
      if (c.proximityMiles === null || c.proximityMiles > criteria.radiusMiles) reason = 'outside_radius';
    }

    if (reason === null && criteria.livingAreaPct !== null && subject.buildingArea) {
      if (c.buildingArea === null || !withinPct(c.buildingArea, subject.buildingArea, criteria.livingAreaPct)) {
        reason = 'living_area';
      }
    }

    if (reason === null && criteria.bedDelta !== null && subject.bedrooms !== null) {
      if (c.bedrooms === null || Math.abs(c.bedrooms - subject.bedrooms) > criteria.bedDelta) reason = 'bedrooms';
    }

    if (reason === null && criteria.bathDelta !== null && subject.baths !== null) {
      if (c.baths === null || Math.abs(c.baths - subject.baths) > criteria.bathDelta) reason = 'bathrooms';
    }

    decisions.push({ candidate: c, selected: reason === null, exclusionReason: reason, displayPosition: null });
  }

  const qualified = decisions.filter((d) => d.selected);

  // Nearest first: proximity is the least arguable ordering, and it makes the
  // map and the table agree without a second sort rule.
  qualified.sort((a, b) => (a.candidate.proximityMiles ?? Infinity) - (b.candidate.proximityMiles ?? Infinity));

  // The ceiling. Anything past it is excluded with a reason, not silently cut,
  // so the stored set still explains itself.
  qualified.forEach((d, i) => {
    if (i < criteria.maxComps) {
      d.displayPosition = i + 1;
    } else {
      d.selected = false;
      d.exclusionReason = 'over_max';
      d.displayPosition = null;
    }
  });

  // Order by displayPosition, NOT by the order SiteX returned them. Sorting
  // `qualified` above reorders that array's references, not `decisions` — so
  // filtering `decisions` here would hand back source order while
  // displayPosition said otherwise, and the table would disagree with the map.
  // That is the precise inconsistency this module exists to prevent.
  const selected = decisions
    .filter((d) => d.selected)
    .sort((a, b) => (a.displayPosition ?? 0) - (b.displayPosition ?? 0));

  return {
    decisions,
    selected: selected.map((d) => d.candidate),
    criteria,
    counts: {
      returned: candidates.length,
      qualified: qualified.length,
      shown: selected.length,
    },
  };
}
