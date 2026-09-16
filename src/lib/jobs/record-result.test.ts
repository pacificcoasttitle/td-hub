import { afterEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { db } from '@/lib/db/client';
import { bindLikeTheDriver } from '@/lib/db/driver-bind';
import {
  RESULT_ARRAY_ITEMS,
  RESULT_MAX_BYTES,
  RESULT_STRING_CHARS,
  capResult,
  completionUpdate,
  recordJobCompletion,
  serializeResult,
} from './record-result';

// Fourteen of 22 job handlers left no record of what a run did: the runner put
// the result only in an HTTP response nobody reads. softpro.enrich_orders
// reported "completed" for two weeks while reading none of 482 hub-created
// orders. These tests pin that the result now reaches the row, bounded.

describe('capResult — bounded, and every cut is marked', () => {
  it('keeps the first items of a long array and says how many were left out', () => {
    const errors = Array.from({ length: 3000 }, (_, i) => ({ fileNumber: `F${i}` }));
    const capped = capResult({ errors }) as { errors: unknown[] };
    expect(capped.errors).toHaveLength(RESULT_ARRAY_ITEMS + 1);
    expect(capped.errors[0]).toEqual({ fileNumber: 'F0' });
    expect(capped.errors.at(-1)).toBe(`… [${3000 - RESULT_ARRAY_ITEMS} more of 3000]`);
  });

  it('shortens a long string and records its real length', () => {
    const capped = capResult('x'.repeat(2000)) as string;
    expect(capped.startsWith('x'.repeat(RESULT_STRING_CHARS))).toBe(true);
    expect(capped.endsWith('[2000 chars]')).toBe(true);
  });

  it('stores dates as ISO strings and drops what JSON cannot hold', () => {
    expect(capResult({ at: new Date('2026-09-16T21:30:00Z'), fn: () => 1, gone: undefined, n: Number.NaN }))
      .toEqual({ at: '2026-09-16T21:30:00.000Z', n: 'NaN' });
  });

  it('leaves an ordinary result exactly as it was', () => {
    const result = { total: 25, attempted: 25, failed: 0, errors: [], stoppedEarly: false };
    expect(capResult(result)).toEqual(result);
  });
});

describe('serializeResult', () => {
  it('stores nothing for a handler that returns nothing', () => {
    expect(serializeResult(undefined)).toBeNull();
  });

  it('replaces a result that is still too large with a note naming its fields', () => {
    const wide = Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`k${i}`, 'y'.repeat(400)]));
    const stored = JSON.parse(serializeResult(wide)!);
    expect(stored).toMatchObject({ truncated: true, keys: expect.arrayContaining(['k0', 'k399']) });
    expect(stored.bytes).toBeGreaterThan(RESULT_MAX_BYTES);
  });

  it('records that a result could not be serialized rather than failing the run', () => {
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    // Depth-capped, so a cycle becomes a marker instead of a throw.
    expect(() => serializeResult(loop)).not.toThrow();
  });
});

describe('completionUpdate — the statement that closes a run', () => {
  const text = (q: ReturnType<typeof completionUpdate>) => new PgDialect().sqlToQuery(q.getSQL()).sql;

  it('merges the result into the payload, so a handler\'s own key survives', () => {
    const q = completionUpdate(228128, { attempted: 25 });
    expect(text(q)).toContain(`coalesce("jobs"."payload", '{}'::jsonb) || jsonb_build_object('result',`);
    expect(text(q)).toContain('"status" = $');
  });

  it('binds the way the production driver binds', () => {
    expect(() => bindLikeTheDriver(completionUpdate(228128, { at: new Date(), errors: ['x'] }).getSQL())).not.toThrow();
  });

  it('writes only the status for a handler that returns nothing', () => {
    expect(text(completionUpdate(1, undefined))).not.toContain('payload');
  });
});

describe('recordJobCompletion', () => {
  afterEach(() => vi.restoreAllMocks());

  it('still marks the run completed when saving the result fails', async () => {
    const sets: Array<Record<string, unknown>> = [];
    let calls = 0;
    vi.spyOn(db, 'update').mockImplementation((() => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          calls++;
          sets.push(values);
          if (calls === 1) throw new Error('invalid input syntax for type json');
        },
      }),
    })) as never);

    await expect(recordJobCompletion(7, { attempted: 1 })).resolves.toBeUndefined();

    expect(sets).toHaveLength(2);
    expect(sets[0]).toHaveProperty('payload');
    expect(sets[1]).toEqual({ status: 'completed', endedAt: expect.any(Date) });
  });
});

describe('the runner uses it', () => {
  it('closes every successful run through recordJobCompletion, with the handler result', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    // Comments stripped: an assertion that can match its own explanation asserts nothing.
    const source = readFileSync(join(process.cwd(), 'src/app/api/jobs/run/route.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(source).toMatch(/const result = await handler\(handlerPayload\);\s*await recordJobCompletion\(jobId, result\);/);
    expect(source).not.toMatch(/set\(\{\s*status:\s*'completed'/);
  });
});
