import { db } from '@/lib/db/client';
import { sql } from 'drizzle-orm';

export const OUTBOX_CLAIM_STALE_MS = 5 * 60 * 1000;
export const OUTBOX_BATCH_LIMIT = 50;
export const OUTBOX_MAX_FAIL_COUNT = 5;

export interface ClaimedOutboxEvent {
  id: number;
  event_type: string;
  order_id: number | null;
  payload: Record<string, unknown> | null;
  fail_count: number;
}

/**
 * Atomically claim unpublished outbox rows (FOR UPDATE SKIP LOCKED).
 * Overlapping every-minute workers get disjoint sets — never the same id.
 * Stale claimed_at (worker died mid-dispatch) is re-claimable.
 */
export async function claimOutboxEvents(
  limit: number = OUTBOX_BATCH_LIMIT,
): Promise<ClaimedOutboxEvent[]> {
  const staleBefore = new Date(Date.now() - OUTBOX_CLAIM_STALE_MS).toISOString();

  const result = await db.execute(sql`
    UPDATE event_outbox
    SET claimed_at = NOW()
    WHERE id IN (
      SELECT id FROM event_outbox
      WHERE published_at IS NULL
        AND fail_count < ${OUTBOX_MAX_FAIL_COUNT}
        AND (claimed_at IS NULL OR claimed_at < ${staleBefore}::timestamp)
      ORDER BY created_at ASC, id ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    RETURNING id, event_type, order_id, payload, fail_count
  `);

  return result as unknown as ClaimedOutboxEvent[];
}

export async function markOutboxPublished(id: number): Promise<void> {
  await db.execute(sql`
    UPDATE event_outbox
    SET published_at = NOW(), claimed_at = NULL
    WHERE id = ${id}
  `);
}

export async function markOutboxFailed(id: number, previousFailCount: number): Promise<void> {
  await db.execute(sql`
    UPDATE event_outbox
    SET fail_count = ${previousFailCount + 1}, claimed_at = NULL
    WHERE id = ${id}
  `);
}

/**
 * In-memory SKIP LOCKED claim — same selection rules as claimOutboxEvents SQL.
 * Used by concurrency tests to prove overlapping runs never share an id.
 */
export function claimOutboxEventsInMemory(
  rows: Array<{
    id: number;
    publishedAt: Date | null;
    claimedAt: Date | null;
    failCount: number;
    locked?: boolean;
  }>,
  opts: { limit: number; now: Date; staleMs?: number },
): number[] {
  const staleMs = opts.staleMs ?? OUTBOX_CLAIM_STALE_MS;
  const staleBefore = opts.now.getTime() - staleMs;
  const claimed: number[] = [];

  const sorted = [...rows].sort((a, b) => a.id - b.id);
  for (const row of sorted) {
    if (claimed.length >= opts.limit) break;
    if (row.publishedAt != null) continue;
    if (row.failCount >= OUTBOX_MAX_FAIL_COUNT) continue;
    if (row.locked) continue; // another worker holds the row lock (SKIP LOCKED)
    if (row.claimedAt != null && row.claimedAt.getTime() >= staleBefore) continue;

    row.claimedAt = opts.now;
    row.locked = true;
    claimed.push(row.id);
  }
  return claimed;
}
