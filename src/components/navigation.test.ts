import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NAV, canSee } from './admin/sidebar-nav';
import { HUB_NAV } from './admin/hub/hub-header';
import { SALES_NAV_ITEMS, buildNav } from './sales/sales-sidebar';
import { NAV_ITEMS as CLIENT_NAV } from './client/client-nav';
import { NAV_BY_ROLE } from '@/lib/security/nav-access';

// ─── Can anybody get there? ─────────────────────────────────────────────────
//
// THIS APPLICATION HAS FOUR NAVIGATIONS, not one:
//
//   admin   SidebarNav, in the (admin) shell, gated by NAV_BY_ROLE
//   hub     HubHeader, a top bar with no sidebar, gated by NAV_BY_ROLE
//   sales   SalesSidebar, built per role by buildNav()
//   client  the portal header, ungated — every client sees both items
//
// On 2026-09-17 /reports shipped with a sidebar entry and no path in
// NAV_BY_ROLE: the link rendered for NOBODY. The test at the time asserted the
// entry existed, sat after Documents, and pointed at a real page — all true.
// Presence is not visibility.
//
// It was then found to be in the wrong navigation as well. The operators work
// in the hub, whose top bar had exactly two links, and reaching Reports from
// there meant the avatar menu, the admin dashboard and then the sidebar. The
// previous test could not have caught that either: it skipped /hub, /sales and
// /client wholesale as "having their own navigation", which is precisely how a
// surface goes unchecked.
//
// So: every navigation, every entry, one question — can somebody see it, and
// does it go somewhere real.

const APP_DIR = join(process.cwd(), 'src/app');

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

const adminHrefs = NAV.flatMap((e) => (e.kind === 'link' ? [e.href] : e.children.map((c) => c.href)));
const hubHrefs = HUB_NAV.map((n) => n.href);
const salesHrefs = SALES_NAV_ITEMS.map((n) => n.href);
const clientHrefs = CLIENT_NAV.map((n) => n.href);

const EVERY_NAV: Array<[string, string[]]> = [
  ['admin sidebar', adminHrefs],
  ['hub header', hubHrefs],
  ['sales sidebar', salesHrefs],
  ['client portal', clientHrefs],
];

describe('every nav entry goes somewhere real', () => {
  it.each(EVERY_NAV)('%s points every entry at a page that exists', (_name, hrefs) => {
    expect(hrefs.filter((href) => !routes.includes(href))).toEqual([]);
  });
});

describe('every nav entry is visible to somebody', () => {
  const roles = Object.entries(NAV_BY_ROLE);
  const seenByARole = (href: string) => roles.some(([, allowed]) => canSee(href, allowed));

  it('the admin sidebar shows every entry to at least one role', () => {
    expect(adminHrefs.filter((h) => !seenByARole(h)),
      'nav entries no role can see — add the path to NAV_BY_ROLE for whoever the page is for')
      .toEqual([]);
  });

  it('the hub header shows every entry to at least one hub role', () => {
    // The hub header reads the same NAV_BY_ROLE through the same canSee(), so
    // the two doors to /reports cannot disagree about who may use them.
    expect(hubHrefs.filter((h) => !seenByARole(h))).toEqual([]);
  });

  it('the sales sidebar builds every item it declares into some role', () => {
    // An item defined in the file and never returned by buildNav() is the same
    // failure in a different shell.
    const built = new Set([
      ...buildNav('sales_rep').top, ...buildNav('sales_rep').orders,
      ...buildNav('sales_manager').top, ...buildNav('sales_manager').orders,
    ].map((i) => i.href));
    expect(salesHrefs.filter((h) => !built.has(h)), 'declared but never built into a nav').toEqual([]);
  });

  it('the client portal is ungated, so its entries are visible by construction', () => {
    // Recorded rather than asserted away: if this nav ever grows a role check,
    // it needs the same treatment as the other three.
    expect(clientHrefs.length).toBeGreaterThan(0);
  });
});

/**
 * Every literal internal destination in the source: href="/x", redirect('/x'),
 * router.push('/x'), router.replace('/x').
 *
 * A NAV ENTRY IS NOT THE ONLY DOOR. On 2026-09-21 this test called /client/orders
 * unreachable, and it was nearly deleted on that word. It is reached by two
 * layout redirects that send a client who lands in the admin shell there, and by
 * a button on the client dashboard. A reachability test that only reads nav
 * components will recommend deleting live pages — so this reads the doors the
 * code actually opens, too.
 */
function inCodeDestinations(): Set<string> {
  const out = new Set<string>();
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(full);
    }
  };
  walk(join(process.cwd(), 'src'));
  const re = /(?:href\s*=\s*\{?\s*|redirect\(\s*|\.push\(\s*|\.replace\(\s*)['"`](\/[^'"`?#$\s]*)/g;
  for (const f of files) {
    for (const m of readFileSync(f, 'utf8').matchAll(re)) out.add(m[1]!.replace(/\/$/, '') || '/');
  }
  return out;
}

describe('every page can be reached', () => {
  const linked = new Set([
    ...adminHrefs, ...hubHrefs, ...salesHrefs, ...clientHrefs,
    ...inCodeDestinations(),
  ]);

  /**
   * Pages deliberately not in any navigation. Anything else that turns up here
   * is a working feature nobody can reach without typing the URL — the same
   * family as the edit button that only appeared on hover, and the unit number
   * that was in every SiteX response and never read.
   *
   * /admin/ops is listed because it is TRUE today, not because it is right.
   * See docs/tickets/REACHABILITY_SWEEP.md.
   */
  const INTENTIONALLY_UNLINKED = new Set([
    '/',                       // marketing root
    '/login',
    '/contacts',               // index landing page; the sidebar links its children
    '/client',                 // redirects to /client/dashboard

    // FIXME — true today, not right. See docs/tickets/REACHABILITY_SWEEP.md.
    '/admin/ops',              // ops console, admin sidebar has no entry
  ]);

  it('has a nav entry for every page, or an explicit reason not to', () => {
    const unreachable = routes
      .filter((route) => !linked.has(route))
      .filter((route) => !INTENTIONALLY_UNLINKED.has(route));
    expect(unreachable, 'pages with no way to reach them — add a nav entry, or '
      + 'add the route to INTENTIONALLY_UNLINKED with a reason').toEqual([]);
  });
});
