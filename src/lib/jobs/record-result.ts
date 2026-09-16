/**
 * Save what a job's handler returned onto its own `jobs` row.
 *
 * ─── WHY ────────────────────────────────────────────────────────────────────
 *
 * The runner used to mark a job `completed` and put the handler's result only
 * in the HTTP response, which nobody reads for a cron run. Fourteen of the 22
 * handlers therefore left no record of what a run did. softpro.enrich_orders
 * reported "completed" every 15 minutes for two weeks while reading none of the
 * 482 orders created in the hub, and the counts that would have shown it were
 * thrown away. Eight handlers had worked around it one at a time by writing
 * their own payload keys; this does it for all of them, in one place.
 *
 * The result lands under `payload.result`, MERGED into whatever is there, so a
 * handler that already records its own key (`syncOrders`, `statusDrift`,
 * `enrichOrders`, …) keeps it and readers of those keys are unaffected.
 *
 * ─── WHY CAPPED ─────────────────────────────────────────────────────────────
 *
 * Some results are large and every run writes a row: the contact syncs can
 * return thousands of per-row errors, `import-orders` has no bound at all, and
 * `notifications.process_outbox` runs 1,440 times a day. The record is for
 * seeing what happened, not for replaying it, so arrays keep their first
 * RESULT_ARRAY_ITEMS entries plus their true length, strings are shortened, and
 * a result still over RESULT_MAX_BYTES is replaced by a note saying so. Nothing
 * is silently dropped: every cut is marked where it was made.
 */
import { eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { jobs } from '@/lib/db/schema';

export const RESULT_ARRAY_ITEMS = 25;
export const RESULT_STRING_CHARS = 500;
export const RESULT_MAX_DEPTH = 6;
export const RESULT_MAX_BYTES = 32_000;

/** A JSON-safe, bounded copy of a handler result. */
export function capResult(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    return value.length > RESULT_STRING_CHARS
      ? `${value.slice(0, RESULT_STRING_CHARS)}… [${value.length} chars]`
      : value;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value !== 'object') return null;
  if (depth >= RESULT_MAX_DEPTH) return '[nested too deep]';

  if (Array.isArray(value)) {
    const kept = value.slice(0, RESULT_ARRAY_ITEMS).map((item) => capResult(item, depth + 1));
    if (value.length > RESULT_ARRAY_ITEMS) {
      kept.push(`… [${value.length - RESULT_ARRAY_ITEMS} more of ${value.length}]`);
    }
    return kept;
  }

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === 'function' || item === undefined) continue;
    out[key] = capResult(item, depth + 1);
  }
  return out;
}

/** The JSON text stored for a result, or null when there is nothing to store. */
export function serializeResult(result: unknown): string | null {
  if (result === undefined) return null;
  let text: string;
  try {
    text = JSON.stringify(capResult(result));
  } catch (err) {
    text = JSON.stringify({ unrecordable: err instanceof Error ? err.message : 'result could not be serialized' });
  }
  if (Buffer.byteLength(text, 'utf8') > RESULT_MAX_BYTES) {
    const keys = result && typeof result === 'object' && !Array.isArray(result) ? Object.keys(result) : [];
    text = JSON.stringify({ truncated: true, bytes: Buffer.byteLength(text, 'utf8'), keys });
  }
  return text;
}

/** The single statement that closes a successful run and saves its result. */
export function completionUpdate(jobId: number, result: unknown) {
  const text = serializeResult(result);
  return db
    .update(jobs)
    .set({
      status: 'completed',
      endedAt: new Date(),
      ...(text === null
        ? {}
        : { payload: sql`coalesce(${jobs.payload}, '{}'::jsonb) || jsonb_build_object('result', ${text}::jsonb)` }),
    })
    .where(eq(jobs.id, jobId));
}

/**
 * Mark the run completed and save its result. Best-effort, like the status
 * update it replaces: a failure to record must not turn a successful run into
 * a failed request. If the combined write fails — a result Postgres refuses as
 * jsonb, say — the status is still written on its own.
 */
export async function recordJobCompletion(jobId: number, result: unknown): Promise<void> {
  try {
    await completionUpdate(jobId, result);
  } catch {
    try {
      await db.update(jobs).set({ status: 'completed', endedAt: new Date() }).where(eq(jobs.id, jobId));
    } catch {
      /* tracking */
    }
  }
}
