import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NAV } from './sidebar-nav';

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

  // ── Every route reachable, every entry routed ──────────────────────────────

  function pageRoutes(dir: string, prefix = ''): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name === 'api' || name.startsWith('[')) continue;
        // (admin), (hub) and friends are route groups: they organise files
        // without appearing in the URL.
        const segment = name.startsWith('(') && name.endsWith(')') ? '' : `/${name}`;
        out.push(...pageRoutes(full, prefix + segment));
      } else if (name === 'page.tsx') {
        out.push(prefix || '/');
      }
    }
    return out;
  }

  const routes = pageRoutes(APP_DIR);
  const hrefs = new Set<string>();
  for (const entry of NAV) {
    if (entry.kind === 'link') hrefs.add(entry.href);
    else for (const child of entry.children) hrefs.add(child.href);
  }

  it('points every nav entry at a page that exists', () => {
    const dangling = [...hrefs].filter((href) => !routes.includes(href));
    expect(dangling, 'nav entries with no page').toEqual([]);
  });

  /**
   * Pages deliberately not in the sidebar. Anything else that turns up here is
   * a working feature nobody can reach without typing the URL — the same
   * family as the edit button that only appeared on hover, and the unit number
   * that was in every SiteX response and never read.
   *
   * /admin/ops is listed because it is TRUE today, not because it is right.
   * See docs/tickets/REACHABILITY_SWEEP.md.
   */
  const INTENTIONALLY_UNLINKED = new Set([
    '/',                    // marketing root
    '/login',
    '/contacts',            // index landing page; the sidebar links its children
    '/admin/ops',           // FIXME: real page, no nav entry — see the ticket
  ]);

  it('has a nav entry for every page, or an explicit reason not to', () => {
    const unreachable = routes
      .filter((route) => !hrefs.has(route))
      .filter((route) => !INTENTIONALLY_UNLINKED.has(route))
      // Client, sales and hub surfaces have their own navigation, roots
      // included — /client is the portal's own landing page, not an orphan.
      .filter((route) => !['/client', '/sales', '/hub'].some(
        (root) => route === root || route.startsWith(root + '/')));
    expect(unreachable, 'pages with no way to reach them — add a nav entry, or '
      + 'add the route to INTENTIONALLY_UNLINKED with a reason').toEqual([]);
  });
});
