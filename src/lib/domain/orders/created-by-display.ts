/**
 * Display rule for the "Created By" column.
 *
 * - Null / undefined creator -> "Synced" (came in via SoftPro sync;
 *   no TD Hub user was involved)
 * - Non-empty name -> return the name as-is
 *
 * This is the SINGLE source of truth for this display. Do not inline
 * this fallback anywhere else.
 */
export function formatCreatedBy(name: string | null | undefined): string {
  if (!name || name.trim() === '') return 'Synced';
  return name;
}

/**
 * Optional style hint for renderers. "Synced" should render gray italic;
 * real names render normal weight. Returns 'system' or 'user'.
 */
export function createdByVariant(name: string | null | undefined): 'system' | 'user' {
  return (!name || name.trim() === '') ? 'system' : 'user';
}
