/**
 * Name format conversion between SoftPro contacts ("Last, First")
 * and the Managers Report API ("First Last").
 *
 * SoftPro stores: "Hernandez, Jerry" or "Wu, Angeline"
 * Managers Report uses: "Jerry Hernandez" or "Angeline Wu"
 *
 * Edge cases handled:
 * - Team names ("Lopez Team") — passed through as-is
 * - Single-word names ("Admin") — passed through as-is
 * - Already in target format — detected and returned unchanged
 * - Multi-part names ("De La Cruz, Maria") → "Maria De La Cruz"
 * - Suffix handling ("Hernandez Jr, Jerry") → "Jerry Hernandez Jr"
 */

/**
 * Convert "Last, First" (SoftPro/contacts) → "First Last" (Managers Report API).
 * If already in "First Last" format (no comma), returns as-is.
 */
export function contactNameToReportName(contactName: string | null): string {
  if (!contactName) return '';
  const trimmed = contactName.trim();
  if (!trimmed) return '';

  if (!trimmed.includes(',')) return trimmed;

  const commaIdx = trimmed.indexOf(',');
  const last = trimmed.slice(0, commaIdx).trim();
  const first = trimmed.slice(commaIdx + 1).trim();

  if (!first) return last;
  return `${first} ${last}`;
}

/**
 * Convert "First Last" (Managers Report) → "Last, First" (contacts format).
 * Handles single-word names and team names gracefully.
 */
export function reportNameToContactName(reportName: string | null): string {
  if (!reportName) return '';
  const trimmed = reportName.trim();
  if (!trimmed) return '';

  if (trimmed.includes(',')) return trimmed;

  const parts = trimmed.split(/\s+/);
  if (parts.length < 2) return trimmed;

  if (isTeamName(trimmed)) return trimmed;

  const last = parts[parts.length - 1]!;
  const first = parts.slice(0, -1).join(' ');
  return `${last}, ${first}`;
}

/**
 * Generate multiple name variants for fuzzy matching against the contacts table.
 * Returns an array of possible formats to try: "First Last", "Last, First",
 * the original name, and lowercase variants.
 */
export function nameVariants(name: string | null): string[] {
  if (!name) return [];
  const trimmed = name.trim();
  if (!trimmed) return [];

  const variants = new Set<string>();
  variants.add(trimmed);
  variants.add(contactNameToReportName(trimmed));
  variants.add(reportNameToContactName(trimmed));

  return [...variants].filter(Boolean);
}

const TEAM_SUFFIXES = ['team', 'group', 'department', 'dept', 'office'];

function isTeamName(name: string): boolean {
  const lower = name.toLowerCase();
  return TEAM_SUFFIXES.some((s) => lower.endsWith(` ${s}`));
}
