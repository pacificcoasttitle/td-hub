/**
 * The Hub does not navigate out of itself.
 *
 * Searching a file number in the Hub table found the order and then sent the
 * operator to /orders/<id> — the admin order page. Two things were wrong with
 * landing there, and the second is the one that cost a morning:
 *
 *   1. It leaves the Hub, mounting the admin sidebar around a view the
 *      operator did not ask for.
 *   2. /orders/[id] renders NO ProposedInsuredModal. So the search worked, the
 *      order was found, and the operator arrived somewhere they could no
 *      longer act on it. It reads like a search bug and is a routing bug.
 *
 * Source assertions rather than a render test because what is being defended
 * is the absence of a navigation. A click test proves one handler behaves; this
 * proves the component has no way to navigate at all.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Comments are stripped before asserting, and that is not a convenience.
 *
 * The comment at the call site explains the bug by naming the call that caused
 * it — so a naive source match trips on the documentation that exists to stop
 * the regression. Strip the prose, assert the code, and the two stop fighting.
 */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .map((line) => line.replace(/(?<![:'"`])\/\/[^'"`]*$/, ''))
    .join('\n');
}

const tableView = code(readFileSync(join(__dirname, 'hub-table-view.tsx'), 'utf8'));
const splitView = code(readFileSync(join(__dirname, 'split/orders-split-view.tsx'), 'utf8'));

describe('hub table view', () => {
  it('has no router at all, so it cannot navigate away', () => {
    expect(tableView).not.toContain('useRouter');
    expect(tableView).not.toContain('router.push');
  });

  it('never links or pushes to the admin order route', () => {
    expect(tableView).not.toMatch(/['"`]\/orders\//);
    expect(tableView).not.toMatch(/window\.location\s*=/);
  });

  it('only links to destinations inside the Hub', () => {
    const hrefs = [...tableView.matchAll(/href=["'{`]+([^"'`}\s]+)/g)].map((m) => m[1]);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(href.startsWith('/hub')).toBe(true);
    }
  });

  it('picking a typeahead result filters in place', () => {
    // Enter always did this (handleSearchSubmit). Only the dropdown navigated,
    // which is why the bug survived: the same box behaved two different ways.
    expect(tableView).toContain('selectSearchResult(r.fileNumber)');
    expect(tableView).toMatch(/function selectSearchResult[\s\S]{0,240}setTableSearch\(fileNumber\)/);
  });

  it('shows the operator what it filtered by', () => {
    // A table narrowed to one row by a filter the search box does not admit to
    // is the next bug report.
    expect(tableView).toMatch(/function selectSearchResult[\s\S]{0,240}setSearchQuery\(fileNumber\)/);
  });
});

describe('hub split view', () => {
  it('also stays in the Hub — selection is state and ?order=, not a route', () => {
    expect(splitView).not.toContain('router.push');
    expect(splitView).not.toMatch(/['"`]\/orders\//);
    expect(splitView).toContain("searchParams.set('order'");
  });
});
