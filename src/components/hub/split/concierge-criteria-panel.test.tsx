import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readSource } from '@/test-support/read-source';
import { DEFAULT_CRITERIA, type CompCriteria } from '@/lib/domain/concierge/comp-filter';

// ─── "The comparable criteria control does nothing" ─────────────────────────
//
// Reported as a live defect on a shipped control. Every link in the chain
// reads correctly — the panel sends, the PATCH route validates, renderProfile
// re-filters and rewrites the row — and the filter itself demonstrably
// responds: selectComps was run against seven criteria sets on profile 4's 25
// stored comparables and changed its selection for every one
// (scripts/audit/concierge-criteria-responds.mts).
//
// What did not work was accumulating the operator's changes before sending
// them. The handler spread a `c` captured at render:
//
//     const set = (k, v) => setC({ ...c, [k]: v });
//
// A range input fires onChange continuously while dragged and React batches,
// so several writes in one tick all spread from the SAME stale object and only
// the last survives. Move three sliders, press Apply, and what reaches the
// server is close to what you started with.
//
// There is no DOM runner in this repo, so the batching itself cannot be
// driven here. The first test demonstrates the mechanism on plain objects;
// the second holds the fix in place, which is the only part a future edit can
// undo.

const PANEL = join(process.cwd(), 'src/components/hub/split/concierge-criteria-panel.tsx');

describe('the mechanism that lost the operator changes', () => {
  it('spreading a captured object drops every write but the last', () => {
    const captured: CompCriteria = { ...DEFAULT_CRITERIA };
    // Both handlers were created in the same render, so both close over the
    // same `captured`.
    const stale = <K extends keyof CompCriteria>(k: K, v: CompCriteria[K]) => ({ ...captured, [k]: v });

    let state = stale('radiusMiles', 0.5);
    state = stale('months', 6);

    expect(state.months).toBe(6);
    expect(state.radiusMiles, 'the radius change survived, so this test is not exercising the bug')
      .toBe(DEFAULT_CRITERIA.radiusMiles);
  });

  it('a functional update composes instead', () => {
    const fresh = (prev: CompCriteria, k: keyof CompCriteria, v: never) => ({ ...prev, [k]: v });

    let state: CompCriteria = { ...DEFAULT_CRITERIA };
    state = fresh(state, 'radiusMiles', 0.5 as never);
    state = fresh(state, 'months', 6 as never);

    expect(state.radiusMiles).toBe(0.5);
    expect(state.months).toBe(6);
  });
});

describe('the panel keeps using a functional update', () => {
  // Only the source shows this — the behaviour needs a DOM and rapid events to
  // reproduce, and by the time it is visible an operator has already been
  // told the software does nothing.
  const src = readSource(PANEL, { mustContain: 'const set =' });

  it('does not spread a captured criteria object', () => {
    expect(src, 'setC({ ...c, ... }) closes over a stale render — use setC((prev) => ...)')
      .not.toMatch(/setC\(\s*\{\s*\.\.\.\s*c\b/);
  });

  it('uses the previous state', () => {
    expect(src).toMatch(/setC\(\s*\(\s*prev\s*\)\s*=>/);
  });
});
