import { DEFAULT_CRITERIA, type CompCriteria } from './comp-filter';

/**
 * One line describing the comparable criteria, for the cost gate.
 *
 * Shown so the operator can see what the document will be built from — but the
 * criteria do NOT shape the SiteX call. They are applied to the comparables
 * after they arrive, which is why they can be changed afterwards for free.
 */
export function summariseCriteria(c: CompCriteria = DEFAULT_CRITERIA): string {
  const parts = [
    c.sameUseCode ? 'same property type' : 'any property type',
    c.livingAreaPct === null ? null : `±${c.livingAreaPct}% area`,
    c.bedDelta === null ? null : `±${c.bedDelta} bed`,
    c.bathDelta === null ? null : `±${c.bathDelta} bath`,
    c.radiusMiles === null ? null : `${c.radiusMiles} ${c.radiusMiles === 1 ? 'mile' : 'miles'}`,
    c.months === null ? null : `${c.months} months`,
    `max ${c.maxComps}`,
  ].filter(Boolean);
  return parts.join(' · ');
}
