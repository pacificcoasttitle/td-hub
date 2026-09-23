import type { SubjectFacts } from './comp-filter';
import type { NormalizedSubject } from './normalize';

/**
 * ─── The second round-trip pair ─────────────────────────────────────────────
 *
 * The four facts that decide WHICH COMPARABLES APPEAR, built two ways:
 *
 *   generate   normalizeSubject(payload) → SubjectFacts → selectComps
 *   re-render  the stored subject_* columns → SubjectFacts → selectComps
 *
 * Same failure shape as the comp mapping (comp-row.ts), and a worse blast
 * radius: a field that diverges here does not change a label, it changes the
 * SET OF SALES on pages 5, 6 and 7. A re-render would quietly show different
 * comparables than the document first issued, with the same criteria printed
 * on page 8.
 *
 * The two sides agree today. They were never held together, which is the only
 * reason they might not tomorrow — so both paths now go through here and a
 * round-trip test compares them.
 *
 * WHY THE COLUMNS AT ALL, when the payload is re-normalised for everything
 * else the document prints: the subject_* columns exist to be queryable, and
 * the filter reads them because they are already loaded with the profile row.
 * Keeping the mapping here means that shortcut cannot drift from the source.
 */

const num = (v: string | number | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** The fields, named once. The round-trip test iterates this. */
export const SUBJECT_FACT_FIELDS = [
  'buildingArea', 'bedrooms', 'baths', 'useCodeDescription',
] as const satisfies readonly (keyof SubjectFacts)[];

/** The generate path: straight from the normalised payload. */
export function subjectFactsFromPayload(s: NormalizedSubject): SubjectFacts {
  return {
    buildingArea: s.buildingArea,
    bedrooms: s.beds,
    baths: s.baths,
    useCodeDescription: s.useDescription,
  };
}

/** What the profile row holds. Only the columns this reads. */
export interface StoredSubjectColumns {
  subjectBuildingArea: number | null;
  subjectBeds: number | null;
  /** numeric column — comes back as a string. */
  subjectBaths: string | null;
  subjectUseDescription: string | null;
}

/** The re-render path: from the stored columns. The inverse of the write below. */
export function subjectFactsFromRow(p: StoredSubjectColumns): SubjectFacts {
  return {
    buildingArea: p.subjectBuildingArea,
    bedrooms: p.subjectBeds,
    baths: num(p.subjectBaths),
    useCodeDescription: p.subjectUseDescription,
  };
}

/**
 * What generate writes for those four. Exported so the round trip is testable
 * against the read above rather than against a copy of it.
 */
export function subjectFactColumns(s: NormalizedSubject): StoredSubjectColumns {
  return {
    subjectBuildingArea: s.buildingArea,
    subjectBeds: s.beds,
    subjectBaths: s.baths === null ? null : String(s.baths),
    subjectUseDescription: s.useDescription,
  };
}
