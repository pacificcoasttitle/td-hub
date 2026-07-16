/**
 * SoftPro note visibility.
 *
 * Documented SoftPro AddNotes body is `{ OrderNumber, Text, Id? }` — no Internal field.
 * There is no GetNotes pull in our integration, so SoftPro-originated notes are not
 * currently synced inbound. If SoftPro later returns or accepts an internal flag under
 * any of the known aliases, resolve it here for storage on `order_notes.is_internal`.
 */
export function resolveSoftProNoteIsInternal(
  payload: Record<string, unknown> | null | undefined,
  fallback = true,
): boolean {
  if (!payload) return fallback;

  for (const key of ['Internal', 'InternalOnly', 'IsInternal', 'isInternal', 'internal'] as const) {
    if (!(key in payload)) continue;
    const value = payload[key];
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
      if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
    }
  }

  return fallback;
}
