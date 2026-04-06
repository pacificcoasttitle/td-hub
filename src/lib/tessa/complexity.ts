// ============================================================
// TESSA™ Complexity Score
// Pure scoring logic extracted from TessaComplexityScore.tsx.
// No UI — returns numeric score, level, and reasons array.
// ============================================================

import type { ExtractedAnalysis, PrelimFacts } from './tessa-types';

export interface ComplexityResult {
  score: number;
  level: 'low' | 'moderate' | 'high' | 'very_high';
  reasons: string[];
}

export function computeComplexity(
  extraction: ExtractedAnalysis,
  facts: PrelimFacts,
): ComplexityResult {
  let score = 0;
  const reasons: string[] = [];

  const liens = extraction.liens ?? [];
  const taxes = extraction.taxes ?? [];
  const reqs = extraction.title_requirements ?? [];
  const other = extraction.other_findings ?? [];
  const ds = extraction.document_status;

  // Liens
  if (liens.length >= 1) { score += 10; reasons.push(`${liens.length} lien${liens.length > 1 ? 's' : ''} on record`); }
  if (liens.length >= 3) { score += 10; reasons.push('Multiple liens detected'); }
  const hasHOA = liens.some((l) => /hoa|homeowner/i.test(l.type ?? ''));
  const hasJudg = liens.some((l) => /judgment/i.test(l.type ?? ''));
  if (hasHOA) { score += 5; reasons.push('HOA lien present'); }
  if (hasJudg) { score += 15; reasons.push('Judgment lien detected'); }

  // Taxes
  const unpaid = taxes.filter(
    (t) =>
      /unpaid|delinquent/i.test(t.first_installment?.status ?? '') ||
      /unpaid|delinquent/i.test(t.second_installment?.status ?? ''),
  );
  if (unpaid.length > 0) { score += 20; reasons.push(`${unpaid.length} delinquent tax parcel${unpaid.length > 1 ? 's' : ''}`); }

  // Requirements
  if (reqs.length >= 5) { score += 10; reasons.push(`${reqs.length} title requirements`); }
  if (reqs.length >= 10) { score += 10; reasons.push('High number of requirements'); }

  // Blockers
  const blockers = reqs.filter((r) => r.severity === 'blocker');
  if (blockers.length > 0) { score += 15; reasons.push(`${blockers.length} blocking requirement${blockers.length > 1 ? 's' : ''}`); }

  // Other findings
  if (other.length >= 3) { score += 10; reasons.push(`${other.length} other findings`); }

  // High-impact findings
  const highImpact = other.filter((f) => f.impact === 'high');
  if (highImpact.length > 0) { score += 10; reasons.push(`${highImpact.length} high-impact finding${highImpact.length > 1 ? 's' : ''}`); }

  // Document status
  if (ds?.missing_sections && ds.missing_sections.length > 0) {
    score += 8; reasons.push('Missing document sections');
  }

  // Foreclosure / recent conveyance
  if (extraction.foreclosure_detected) { score += 20; reasons.push('Foreclosure activity detected'); }
  if (extraction.recent_conveyance_detected) { score += 5; reasons.push('Recent conveyance'); }

  // Facts augmentation
  const exceptions = facts?.requirements?.length ?? 0;
  if (exceptions >= 8) { score += 5; }
  if (exceptions >= 15) { score += 5; }

  score = Math.min(score, 100);

  let level: ComplexityResult['level'];
  if (score <= 25) level = 'low';
  else if (score <= 50) level = 'moderate';
  else if (score <= 75) level = 'high';
  else level = 'very_high';

  return { score, level, reasons };
}
