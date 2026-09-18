import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';


const SOURCE = readFileSync(join(process.cwd(), 'src/components/admin/sidebar-nav.tsx'), 'utf8');
const APP_DIR = join(process.cwd(), 'src/app');

/**
 * What this file can and cannot check.
 *
 * It CANNOT measure pixels. There is no DOM in this test environment, and even
 * with jsdom there would be no layout — `getBoundingClientRect` returns zeroes,
 * so a rendered-and-measured assertion is not available without adding a real
 * browser runner. The clipping that hid three menu entries for four months was
 * measured by hand, in a browser, against the real Tailwind classes.
 *
 * What it CAN check is the invariant that makes the measurement unnecessary:
 * the container must size to its content. A fixed height cap is the only way
 * this failure happens, so forbidding the cap forbids the failure. That is a
 * stronger guarantee than asserting "six entries fit", which would just encode
 * the magic number that caused the bug.
 *
 * WHY A SOURCE-LEVEL CHECK IS THE RIGHT SHAPE HERE. The post-merge check that
 * missed this compared nav labels to page titles. All nine pairs passed — the
 * two invisible entries passed it too. A label can be correct, permitted,
 * routed and typed right and still sit 100px below a clipping boundary;
 * nothing in the source says "row seven". The fix removes the boundary
 * entirely, so what is left to assert is that nobody puts one back.
 */
describe('sidebar nav', () => {
  /**
   * The JSX that wraps a section's children.
   *
   * Anchored on `entry.children.map(` rather than on the container's own
   * classes, so the assertion still finds the container after the markup is
   * rewritten — including rewritten back to something with a height cap. An
   * anchor made of the classes being asserted only ever finds the version that
   * already passes.
   */
  function childrenContainerJsx(): string {
    // Comments come off the WHOLE file before anything is located. The block
    // above this container explains the regression in prose and names both
    // `max-h-60` and `grid-rows-[1fr]`; a slice that begins inside that comment
    // cannot strip it afterwards, and the assertion would end up reading its
    // own documentation and passing on it.
    const code = SOURCE.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const anchor = code.indexOf('{entry.children.map(');
    expect(anchor, 'section children render not found — did the markup change?').toBeGreaterThan(-1);
    const opening = code.lastIndexOf('<div', anchor);
    return code.slice(Math.max(0, opening - 500), anchor);
  }

  // REGRESSION 2026-05-19 → 2026-09-10. `max-h-60` is 240px; nine children are
  // 340px; `overflow-hidden` meant the excess was invisible rather than
  // scrollable. Mortgage Companies, Mortgage Employees and the generic
  // Companies page were unreachable from the sidebar in production, the last
  // of those for almost four months.
  it('does not cap the height of a section, at any number', () => {
    const container = childrenContainerJsx();
    const caps = container.match(/\bmax-h-(?!0\b)[\w[\]().-]+/g) ?? [];
    expect(caps, `fixed height cap(s) ${caps.join(', ')} reintroduced — a section `
      + 'taller than the cap loses its last entries silently, with no scrollbar. '
      + 'Animate with grid-rows-[0fr]/[1fr] so the container sizes to its content.')
      .toEqual([]);
    expect(container, 'the expanded state must size to its content')
      .toContain('grid-rows-[1fr]');
  });

  it('collapses to nothing when closed', () => {
    expect(childrenContainerJsx()).toContain('grid-rows-[0fr]');
  });

  // Reachability moved to src/components/navigation.test.ts, which asks the
  // same questions of all FOUR navigations — this file had checked only the
  // admin sidebar, and Reports turned out to be missing from the hub's.
});
