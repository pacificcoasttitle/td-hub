// Display-only helpers for My Clients. These never change stored data — the
// CSV export and the edit form deliberately show the raw `name` field.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function looksLikeEmail(value: string | null | undefined): boolean {
  return EMAIL_RE.test((value ?? '').trim());
}

/**
 * Some clients arrive with an email address in `name` because no display name
 * was available at the point of entry. Showing "jasmine@nationalleadersescrow.com"
 * as a person's name reads badly in a rolodex, so prefer the company when the
 * name is just an email. Falls back to the email itself when there is no
 * company — better a raw address than nothing.
 */
export function displayClientName(
  name: string | null | undefined,
  company?: string | null,
): string {
  const trimmedName = (name ?? '').trim();
  if (trimmedName && !looksLikeEmail(trimmedName)) return trimmedName;

  const trimmedCompany = (company ?? '').trim();
  if (trimmedCompany) return trimmedCompany;

  return trimmedName || 'Unnamed client';
}
