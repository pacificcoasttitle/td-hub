/**
 * Near-match for firm create. Legacy matched exact name only, so
 * "Wells Fargo" and "Wells Fargo Bank" became two SoftPro firms.
 *
 * Suggestions only — the operator picks or confirms create. Score 100 is
 * the same normalized name and street; that is a hard duplicate, not a suggestion.
 */

export interface FirmCandidate {
  id: number;
  name: string;
  lookupCode: string | null;
  address1: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  email: string | null;
}

export interface ScoredFirm extends FirmCandidate {
  score: number;
  reason: 'exact_name_address' | 'exact_name' | 'contains' | 'tokens' | 'address_city' | 'lookup';
}

export function normalizeFirmName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function significantTokens(normalized: string): string[] {
  return normalized.split(' ').filter((t) => t.length >= 3);
}

export function scoreCompanyMatch(
  query: { name: string; address1?: string; city?: string; lookupCode?: string },
  row: { name: string; address1?: string | null; city?: string | null; lookupCode?: string | null },
): { score: number; reason: ScoredFirm['reason'] } | null {
  const qn = normalizeFirmName(query.name);
  const rn = normalizeFirmName(row.name);
  const qa = normalizeFirmName(query.address1 ?? '');
  const ra = normalizeFirmName(row.address1 ?? '');
  const qc = normalizeFirmName(query.city ?? '');
  const rc = normalizeFirmName(row.city ?? '');

  if (query.lookupCode && row.lookupCode
    && query.lookupCode.trim().toLowerCase() === row.lookupCode.trim().toLowerCase()) {
    return { score: 95, reason: 'lookup' };
  }

  if (qn && rn && qn === rn) {
    if (qa && ra && qa === ra) return { score: 100, reason: 'exact_name_address' };
    return { score: 90, reason: 'exact_name' };
  }

  if (qn && rn && (qn.includes(rn) || rn.includes(qn))) {
    return { score: 70, reason: 'contains' };
  }

  const qt = new Set(significantTokens(qn));
  const rt = significantTokens(rn);
  const overlap = rt.filter((t) => qt.has(t)).length;
  if (overlap >= 2 || (overlap >= 1 && qt.size === 1 && rt.length >= 1 && qt.has(rt[0]!))) {
    return { score: 50 + overlap, reason: 'tokens' };
  }

  if (qa && ra && qa === ra && qc && rc && qc === rc) {
    return { score: 55, reason: 'address_city' };
  }

  return null;
}

export function rankFirmMatches(
  query: { name: string; address1?: string; city?: string; lookupCode?: string },
  rows: FirmCandidate[],
): ScoredFirm[] {
  const scored: ScoredFirm[] = [];
  for (const row of rows) {
    const hit = scoreCompanyMatch(query, row);
    if (!hit) continue;
    scored.push({ ...row, score: hit.score, reason: hit.reason });
  }
  return scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}
