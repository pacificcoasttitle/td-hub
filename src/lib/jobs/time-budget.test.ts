import { describe, expect, it } from 'vitest';
import {
  budgetMsFor,
  createDeadline,
  FUNCTION_CEILING_MS,
  partialBatch,
  SAFETY_MARGIN_MS,
  UNIT_P99_MS,
  type BudgetedJob,
} from './time-budget';

const JOBS = Object.keys(UNIT_P99_MS) as BudgetedJob[];

describe('budget sizing', () => {
  it('leaves room for one more worst-case unit — the trap a flat budget falls into', () => {
    // The failure mode: check the clock at the budget, claim one more unit,
    // and that unit runs to its p99. That must still land under the ceiling.
    for (const job of JOBS) {
      const worstCaseFinish = budgetMsFor(job) + UNIT_P99_MS[job];
      expect(worstCaseFinish).toBeLessThanOrEqual(FUNCTION_CEILING_MS);
    }
  });

  it('would NOT be safe at a flat 240s for the heaviest job', () => {
    // fetch_prelims runs TESSA inline (p99 ~90s for a unit). 240 + 90 = 330 > 300.
    const flat = 240_000;
    expect(flat + UNIT_P99_MS['softpro.fetch_prelims']).toBeGreaterThan(FUNCTION_CEILING_MS);
    // The chosen budget is correspondingly tighter.
    expect(budgetMsFor('softpro.fetch_prelims')).toBeLessThan(flat);
  });

  it('gives the TESSA-bound job the smallest budget', () => {
    expect(budgetMsFor('softpro.fetch_prelims')).toBe(180_000);
    expect(budgetMsFor('softpro.enrich_orders')).toBe(210_000);
    expect(budgetMsFor('softpro.enrich_order_details')).toBe(210_000);
  });

  it('keeps every budget positive and under the ceiling', () => {
    for (const job of JOBS) {
      expect(budgetMsFor(job)).toBeGreaterThan(0);
      expect(budgetMsFor(job)).toBeLessThan(FUNCTION_CEILING_MS);
    }
  });

  it('reserves a safety margin on top of the unit allowance', () => {
    for (const job of JOBS) {
      expect(FUNCTION_CEILING_MS - budgetMsFor(job)).toBeGreaterThanOrEqual(SAFETY_MARGIN_MS);
    }
  });
});

describe('createDeadline', () => {
  function fakeClock(start = 1_000_000) {
    let t = start;
    return { now: () => t, advance: (ms: number) => { t += ms; } };
  }

  it('is not exceeded before the budget', () => {
    const c = fakeClock();
    const d = createDeadline('softpro.enrich_orders', c.now);
    expect(d.exceeded()).toBe(false);
    c.advance(209_999);
    expect(d.exceeded()).toBe(false);
  });

  it('is exceeded exactly at the budget', () => {
    const c = fakeClock();
    const d = createDeadline('softpro.enrich_orders', c.now);
    c.advance(210_000);
    expect(d.exceeded()).toBe(true);
  });

  it('reports elapsed and remaining, clamped at zero', () => {
    const c = fakeClock();
    const d = createDeadline('softpro.fetch_prelims', c.now);
    c.advance(60_000);
    expect(d.elapsedMs()).toBe(60_000);
    expect(d.remainingMs()).toBe(120_000);
    c.advance(500_000);
    expect(d.remainingMs()).toBe(0);
  });
});

describe('partialBatch', () => {
  it('reports remaining work only when it actually stopped early', () => {
    expect(partialBatch(true, 12)).toEqual({ stoppedEarly: true, remaining: 12 });
  });
  it('reports nothing remaining when the batch finished naturally', () => {
    expect(partialBatch(false, 12)).toEqual({ stoppedEarly: false, remaining: 0 });
  });
});
