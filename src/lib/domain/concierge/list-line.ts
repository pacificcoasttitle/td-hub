/**
 * What the Reports list prints for a property profile.
 *
 * ─── WHY THIS IS STORED RATHER THAN DERIVED ─────────────────────────────────
 *
 * Subject and Settings are columns on the report row (migration 0058), written
 * here at creation and REWRITTEN whenever the thing they describe changes — the
 * criteria line is rewritten by every render, because a profile re-filtered to
 * half a mile must not keep advertising one mile.
 *
 * Stored, not derived, so the list is one query over four tables rather than a
 * type-to-column mapping every reader has to keep in step. Stored does not mean
 * written once.
 */
import type { CompCriteria } from './comp-filter';

/**
 * The criteria in the width of a table cell: distance, recency, size tolerance.
 * `null` means a filter was not applied at all, which is not the same as zero
 * and must not read as one.
 */
export function criteriaSummary(c: {
  radiusMiles: CompCriteria['radiusMiles'];
  months: CompCriteria['months'];
  livingAreaPct: CompCriteria['livingAreaPct'];
}): string {
  const parts = [
    c.radiusMiles === null ? 'any distance' : `${c.radiusMiles} mi`,
    c.months === null ? 'any date' : `${c.months} mo`,
  ];
  if (c.livingAreaPct !== null) parts.push(`±${c.livingAreaPct}% size`);
  return parts.join(' · ');
}

/**
 * The address AS REQUESTED, not as SiteX resolved it. The row exists before the
 * vendor answers, and a failed generation still has to say which property was
 * asked for — that is the first question anyone asks of a failed row.
 */
export function profileListSubject(input: {
  street: string; city: string; state: string; zip: string;
}): { listSubject: string; listSubjectDetail: string } {
  const detail = [`${input.city.trim()},`, input.state.trim(), input.zip.trim()]
    .join(' ').replace(/\s+/g, ' ').trim();
  return { listSubject: input.street.trim(), listSubjectDetail: detail };
}
