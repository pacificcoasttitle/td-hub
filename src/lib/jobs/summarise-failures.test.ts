import { describe, expect, it } from 'vitest';
import { summariseFailures } from './summarise-failures';

describe('a job that returns is not a job that succeeded', () => {
  it('the live case: retry_document_attach, every call 400', () => {
    // The 06:20:47 run: four AddDocuments posts, all rejected as duplicates.
    // 5,926 runs of this shape were recorded `completed` with no error.
    const r = summariseFailures({
      total: 4, attempted: 4, synced: 0, failed: 4, skipped: 0,
      errors: [
        { documentId: 6287, error: 'item 0: Status=400, Message=An item already exists by that name.' },
        { documentId: 6286, error: 'item 0: Status=400, Message=An item already exists by that name.' },
      ],
    });
    expect(r.status).toBe('failed');
    expect(r.error).toContain('4 of 4 failed');
    expect(r.error).toContain('already exists');
  });

  it('a partial run stays completed but carries the reason', () => {
    // Work landed. Flipping status here would make every partly-successful
    // sweep look like an outage.
    const r = summariseFailures({ attempted: 25, synced: 23, failed: 2, errors: [{ documentId: 1, error: 'locked' }] });
    expect(r.status).toBe('completed');
    expect(r.error).toContain('2 of 25 failed');
  });

  it('a clean run records nothing', () => {
    expect(summariseFailures({ attempted: 10, synced: 10, failed: 0 })).toEqual({ status: 'completed', error: null });
  });

  it('handlers that report no failure count are untouched', () => {
    // processOutbox, watchdog, drain — no `failed` field, no behaviour change.
    for (const v of [undefined, null, {}, { processed: 12 }, 'ok', 42]) {
      expect(summariseFailures(v), JSON.stringify(v)).toEqual({ status: 'completed', error: null });
    }
  });

  it('total failure with no synced field still reads as failed', () => {
    expect(summariseFailures({ total: 3, failed: 3 }).status).toBe('failed');
  });

  it('error text is capped', () => {
    const r = summariseFailures({
      attempted: 500, synced: 0, failed: 500,
      errors: Array.from({ length: 500 }, (_, i) => ({ documentId: i, error: 'x'.repeat(200) })),
    });
    expect(r.error!.length).toBeLessThanOrEqual(2000);
    expect(r.error).toContain('+497 more');
  });

  it('a non-numeric failed field is ignored rather than trusted', () => {
    expect(summariseFailures({ failed: 'lots' }).status).toBe('completed');
    expect(summariseFailures({ failed: NaN }).status).toBe('completed');
  });
});
