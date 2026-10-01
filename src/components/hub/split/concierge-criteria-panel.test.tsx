import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readSource } from '@/test-support/read-source';

// ─── A style guard, NOT a fix for "the criteria control does nothing" ───────
//
// An earlier version of this file asserted that the captured-spread idiom
//
//     const set = (k, v) => setC({ ...c, [k]: v });
//
// was the cause of the reported defect. It is not. stale-closure-probe.test.tsx
// drives both idioms with two writes batched into a single act() under React
// 19 and the captured-spread version keeps BOTH of them — `change` is a
// discrete event, React flushes it synchronously, and the closure is never
// stale between slider moves.
//
// The functional form is still what this panel should use, because it holds
// under any batching regime and costs nothing. That is all this file claims.
//
// The behaviour of the panel is covered by
// concierge-criteria-panel.interactive.test.tsx, which renders it and drives
// the controls.

const PANEL = join(process.cwd(), 'src/components/hub/split/concierge-criteria-panel.tsx');

describe('the panel uses a functional state update', () => {
  const src = readSource(PANEL, { mustContain: 'const set =' });

  it('does not spread a captured criteria object', () => {
    expect(src, 'setC({ ...c, ... }) is safe under discrete events and not under '
      + 'a transition or an async boundary — use setC((prev) => ...)')
      .not.toMatch(/setC\(\s*\{\s*\.\.\.\s*c\b/);
  });

  it('uses the previous state', () => {
    expect(src).toMatch(/setC\(\s*\(\s*prev\s*\)\s*=>/);
  });
});
