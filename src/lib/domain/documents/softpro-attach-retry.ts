/** Max SoftPro AddDocuments attempts before giving up (still visible as failed). */
export const SOFTPRO_ATTACH_MAX_ATTEMPTS = 8;

/** Backoff after attempt N (1-based), in milliseconds. */
const BACKOFF_MS = [
  5 * 60_000,       // after 1st fail → 5m
  15 * 60_000,      // 15m
  60 * 60_000,      // 1h
  4 * 60 * 60_000,  // 4h
  12 * 60 * 60_000, // 12h
  24 * 60 * 60_000, // 24h
  24 * 60 * 60_000, // 24h
];

export function softProAttachNextRetryAt(attemptCount: number, from = new Date()): Date | null {
  if (attemptCount >= SOFTPRO_ATTACH_MAX_ATTEMPTS) return null;
  const idx = Math.min(Math.max(attemptCount - 1, 0), BACKOFF_MS.length - 1);
  return new Date(from.getTime() + BACKOFF_MS[idx]!);
}

export function extractSoftProDocumentId(data: unknown, fallbackDocumentId: number): string {
  if (Array.isArray(data) && data.length > 0) {
    const first = data[0] as { Id?: unknown; id?: unknown; documentId?: unknown };
    const raw = first.Id ?? first.id ?? first.documentId;
    if (typeof raw === 'string' && raw.trim()) return raw.trim();
    if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  }
  if (data && typeof data === 'object') {
    const obj = data as { documentId?: unknown; Id?: unknown };
    const raw = obj.documentId ?? obj.Id;
    if (typeof raw === 'string' && raw.trim()) return raw.trim();
    if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  }
  return String(fallbackDocumentId);
}
