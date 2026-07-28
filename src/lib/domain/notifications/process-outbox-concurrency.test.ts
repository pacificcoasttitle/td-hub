import { describe, expect, it, vi } from 'vitest';
import { processOutboxEvents } from './service';
import { claimOutboxEventsInMemory } from './outbox-claim';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Serialize claim steps to mimic a DB transaction (atomic SELECT FOR UPDATE + UPDATE). */
function createClaimMutex() {
  let chain: Promise<unknown> = Promise.resolve();
  return function runExclusive<T>(fn: () => T): Promise<T> {
    const next = chain.then(() => fn());
    chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
}

describe('processOutboxEvents overlap safety (*/1)', () => {
  it('claim SQL uses FOR UPDATE SKIP LOCKED', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/lib/domain/notifications/outbox-claim.ts'),
      'utf8',
    );
    expect(src).toContain('FOR UPDATE SKIP LOCKED');
    expect(src).toContain('claimed_at');
  });

  it('two overlapping processOutboxEvents runs dispatch each event EXACTLY ONCE', async () => {
    const now = new Date();
    const rows = [1, 2, 3, 4, 5, 6].map((id) => ({
      id,
      event_type: id % 2 === 0 ? 'order.closed' : 'order.document.received',
      order_id: 1000 + id,
      payload: { n: id } as Record<string, unknown>,
      publishedAt: null as Date | null,
      claimedAt: null as Date | null,
      failCount: 0,
    }));

    const runExclusive = createClaimMutex();
    const dispatched: Array<{ id: number; eventType: string; orderId: number }> = [];

    const claim = async (limit: number) => {
      // Brief yield so both runs enter processOutboxEvents before either finishes claiming.
      await new Promise((r) => setTimeout(r, 5));
      return runExclusive(() => {
        const ids = claimOutboxEventsInMemory(rows, { limit, now });
        return ids.map((id) => {
          const row = rows.find((r) => r.id === id)!;
          return {
            id: row.id,
            event_type: row.event_type,
            order_id: row.order_id,
            payload: row.payload,
            fail_count: row.failCount,
          };
        });
      });
    };

    const dispatch = vi.fn(async (eventType: string, orderId: number | null) => {
      // Slow dispatch so the sibling run overlaps mid-batch.
      await new Promise((r) => setTimeout(r, 15));
      const row = rows.find((r) => r.order_id === orderId);
      if (!row) throw new Error(`missing row for order ${orderId}`);
      dispatched.push({ id: row.id, eventType, orderId: orderId! });
    });

    const markPublished = async (id: number) => {
      const row = rows.find((r) => r.id === id);
      if (row) {
        row.publishedAt = new Date();
        row.claimedAt = null;
      }
    };

    // Small batches so overlapping workers partition the queue (not one taking all).
    const deps = {
      claim,
      dispatch,
      markPublished,
      markFailed: async () => {},
      sweep: async () => ({ checked: 0, enqueued: 0 }),
      batchLimit: 3,
    };

    const [a, b] = await Promise.all([
      processOutboxEvents(deps),
      processOutboxEvents(deps),
    ]);

    const totalProcessed = a.processed + b.processed;
    expect(totalProcessed).toBe(6);
    expect(a.succeeded + b.succeeded).toBe(6);
    expect(dispatched).toHaveLength(6);

    const ids = dispatched.map((d) => d.id).sort((x, y) => x - y);
    expect(ids).toEqual([1, 2, 3, 4, 5, 6]);
    expect(new Set(ids).size).toBe(6); // no double-dispatch

    // Both workers made progress (partitioned claim), not one skipping entirely.
    expect(a.processed).toBe(3);
    expect(b.processed).toBe(3);
    expect(dispatch).toHaveBeenCalledTimes(6);
  });

  it('in-memory claim never returns the same id to two concurrent claimants', () => {
    const now = new Date();
    const rows = [1, 2, 3, 4].map((id) => ({
      id,
      publishedAt: null as Date | null,
      claimedAt: null as Date | null,
      failCount: 0,
    }));

    const a = claimOutboxEventsInMemory(rows, { limit: 2, now });
    const b = claimOutboxEventsInMemory(rows, { limit: 2, now });

    expect(a).toHaveLength(2);
    expect(b).toHaveLength(2);
    expect(new Set([...a, ...b]).size).toBe(4);
    expect(a.some((id) => b.includes(id))).toBe(false);
  });
});
