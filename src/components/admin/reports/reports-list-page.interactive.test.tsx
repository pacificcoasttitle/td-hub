// @vitest-environment jsdom
import '@/test-support/interactive-timeout';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReportListRow } from '@/lib/domain/reports/list-types';
import { ReportGroup, ReportRow, groupRows } from './reports-list-page';
import { TEMPLATE_VERSION as CONCIERGE_TEMPLATE } from '@/lib/domain/concierge/document/template-version';

// ─── What the kebab offers, and what it costs ───────────────────────────────
//
// The Actions column collapsed into a menu, so every assertion about what a row
// offers became a statement about an interaction: a static render sees a closed
// menu and nothing else. These open it.
//
// The one that matters most is the last describe: exactly one item in this menu
// spends money, and it has to say so among four items that say "free".

afterEach(cleanup);
beforeEach(() => { vi.unstubAllGlobals(); vi.stubGlobal('open', vi.fn()); });

const row = (over: Partial<ReportListRow> = {}): ReportListRow => ({
  type: 'county_sales', id: 3, typeLabel: 'County Sales', sourceLine: 'Dataset',
  subject: 'Orange County', subjectDetail: '44 cities', settings: 'August 2026',
  brandedToName: 'Maria Lopez', brandedToEmail: 'mlopez@pct.com', status: 'generated',
  createdAt: '2026-09-16 21:14:00', createdBy: 'ops@pct.com', madeBy: 'Operations',
  delivery: null, templateVersion: 'cs-v1', groupKey: null, taxStatus: null,
  ...over,
});

const profile = (over: Partial<ReportListRow> = {}) => row({
  type: 'concierge_profile', typeLabel: 'Concierge Profile', sourceLine: '1 credit spent',
  subject: '1358 5TH ST, LA VERNE, CA 91750', templateVersion: CONCIERGE_TEMPLATE,
  groupKey: '1358 5th st|la verne|ca|91750', ...over,
});

const inTable = (el: React.ReactElement) => render(<table><tbody>{el}</tbody></table>);
const openMenu = () => fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
const items = () => screen.queryAllByRole('menuitem').map((i) => i.textContent ?? '');

describe('the menu holds the controls that used to fill the cell', () => {
  it('shows nothing until it is opened', () => {
    inTable(<ReportRow row={row()} />);
    expect(items()).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Actions' })).toBeTruthy();
  });

  it('offers Download and Notify rep on a farming report', () => {
    inTable(<ReportRow row={row()} />);
    openMenu();
    const text = items().join(' | ');
    expect(text).toContain('Download');
    expect(text).toContain('Notify rep');
    expect(text).not.toContain('Comparables');
  });

  it('offers Download, Refresh, Comparables and tax detail on a profile', () => {
    inTable(<ReportRow row={profile()} />);
    openMenu();
    const text = items().join(' | ');
    expect(text).toContain('Download');
    expect(text).toContain('Refresh document');
    expect(text).toContain('Comparables');
    expect(text).toContain('Add tax detail');
    expect(text).not.toContain('Notify rep');
  });

  it('offers a retry and no download on a failed report', () => {
    inTable(<ReportRow row={row({ status: 'failed' })} />);
    openMenu();
    const text = items().join(' | ');
    expect(text).toContain('Try again');
    expect(text).not.toContain('Download');
  });

  it('carries the older-layout explanation as a note, not in the cell', () => {
    inTable(<ReportRow row={profile({ templateVersion: 'v2' })} />);
    openMenu();
    const text = items().join(' | ');
    expect(text).toContain('older layout (v2)');
    expect(text).toContain('calls no vendor');
  });

  it('closes on Escape without bubbling', () => {
    const onOuterEscape = vi.fn();
    render(
      <div onKeyDown={(e) => { if (e.key === 'Escape') onOuterEscape(); }}>
        <table><tbody><ReportRow row={row()} /></tbody></table>
      </div>,
    );
    openMenu();
    expect(items().length).toBeGreaterThan(0);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(items()).toHaveLength(0);
    expect(onOuterEscape).not.toHaveBeenCalled();
  });
});

describe('the row opens the report, and the menu does not', () => {
  it('opens the PDF when the row is clicked', () => {
    const { container } = inTable(<ReportRow row={row()} />);
    fireEvent.click(container.querySelector('tr')!);
    expect(window.open).toHaveBeenCalledTimes(1);
    expect((window.open as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toContain('/api/reports/county_sales/3/pdf');
  });

  it('stays a table row, so the grid keeps its structure', () => {
    // The first version of the clickable row put role="link" on the <tr>. That
    // works for a mouse and removes the row from the table for everyone using a
    // screen reader — one shortcut bought at the cost of the whole grid.
    inTable(<ReportRow row={row()} />);
    expect(screen.getAllByRole('row')).toHaveLength(1);
  });

  it('gives the keyboard a real link rather than a synthetic click', () => {
    // An anchor is focusable, announced as a link, and supports middle-click and
    // copy-link-address. A keydown handler on a <tr> gives none of that.
    inTable(<ReportRow row={row()} />);
    const link = screen.getByRole('link', { name: 'Orange County' });
    expect(link.getAttribute('href')).toContain('/api/reports/county_sales/3/pdf');
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('opens one tab, not two, when the link itself is clicked', () => {
    // Without stopPropagation the row handler fires as well and the operator
    // gets the same PDF twice.
    inTable(<ReportRow row={row()} />);
    fireEvent.click(screen.getByRole('link', { name: 'Orange County' }));
    expect(window.open).not.toHaveBeenCalled();
  });

  it('does not open the report when the kebab is clicked', () => {
    // The whole row is clickable, so without stopPropagation every attempt to
    // reach the menu would also open a PDF in a new tab.
    inTable(<ReportRow row={row()} />);
    openMenu();
    expect(window.open).not.toHaveBeenCalled();
    expect(items().length).toBeGreaterThan(0);
  });

  it('does not open the report when a menu item is clicked', () => {
    inTable(<ReportRow row={profile()} />);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /Comparables/ }));
    expect(window.open).not.toHaveBeenCalled();
  });

  it('is not clickable, and offers no link, while building', () => {
    const { container } = inTable(<ReportRow row={row({ status: 'pending' })} />);
    expect(screen.queryByRole('link')).toBeNull();
    fireEvent.click(container.querySelector('tr')!);
    expect(window.open).not.toHaveBeenCalled();
  });
});

describe('re-runs on one property are grouped, and nothing is hidden', () => {
  const key = '1358 5th st|la verne|ca|91750';
  const five = [1, 2, 3, 4, 5].map((n) => profile({ id: n, groupKey: key }));

  it('groups rows that share a property key', () => {
    const groups = groupRows(five);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.rows).toHaveLength(5);
  });

  it('never groups farming reports, which are not about one property', () => {
    const groups = groupRows([row({ id: 1 }), row({ id: 2 })]);
    expect(groups).toHaveLength(2);
  });

  it('never groups a profile whose key predates the column', () => {
    // A null key means "answers no question about which property this is", not
    // "the same property as the other nulls".
    const groups = groupRows([profile({ id: 1, groupKey: null }), profile({ id: 2, groupKey: null })]);
    expect(groups).toHaveLength(2);
  });

  it('states the count of earlier profiles and does not hide them', () => {
    // THROUGH groupRows, not a hand-built group. The first version of this test
    // passed `{ rows: five }` directly, so the one mutation that matters —
    // dropping the siblings instead of collecting them, which is dedupe by
    // hiding — left the test whose NAME promises this invariant perfectly green.
    // Only the shape test caught it.
    const groups = groupRows(five);
    expect(groups, 'grouping collapsed to one group').toHaveLength(1);
    render(<table><tbody><ReportGroup group={groups[0]!} /></tbody></table>);

    // COLLAPSED IS NOT HIDDEN. The count is on screen, exact, before any click:
    // all five were paid for and all five are on an invoice.
    expect(screen.getByText('4 earlier profiles on this property')).toBeTruthy();
    expect(screen.getAllByRole('row')).toHaveLength(1);

    fireEvent.click(screen.getByText('4 earlier profiles on this property'));
    expect(screen.getAllByRole('row')).toHaveLength(5);
    expect(screen.getAllByText(/Earlier profile/)).toHaveLength(4);

    fireEvent.click(screen.getByText('Hide earlier profiles'));
    expect(screen.getAllByRole('row')).toHaveLength(1);
  });

  it('says "1 earlier profile", not "1 earlier profiles"', () => {
    render(<table><tbody><ReportGroup group={groupRows(five.slice(0, 2))[0]!} /></tbody></table>);
    expect(screen.getByText('1 earlier profile on this property')).toBeTruthy();
  });

  it('keeps every paid-for row, counted against the input', () => {
    // The invariant stated as arithmetic rather than as a rendering: whatever
    // grouping does to the shape, the number of reports in must equal the number
    // out. This is the assertion that a dedupe cannot pass.
    const mixed = [...five, row({ id: 9 }), profile({ id: 10, groupKey: 'other|key' })];
    const total = groupRows(mixed).reduce((n, g) => n + g.rows.length, 0);
    expect(total).toBe(mixed.length);
  });

  it('offers no toggle on a property with a single profile', () => {
    render(<table><tbody><ReportGroup group={{ rows: [profile()] }} /></tbody></table>);
    expect(screen.queryByText(/earlier profile/)).toBeNull();
  });

  it('expanding does not open a PDF', () => {
    render(<table><tbody><ReportGroup group={{ rows: five }} /></tbody></table>);
    fireEvent.click(screen.getByText('4 earlier profiles on this property'));
    expect(window.open).not.toHaveBeenCalled();
  });
});

// ─── The one item that spends ───────────────────────────────────────────────

describe('the tax item is priced, and never sells the same search twice', () => {
  const open = (r: ReportListRow) => { inTable(<ReportRow row={r} />); openMenu(); };

  it('offers it priced when it has never been asked for', () => {
    open(profile({ taxStatus: null }));
    const item = screen.getByRole('menuitem', { name: /Add tax detail/ });
    expect(item.textContent).toContain('one search');
    // Among items that say "free", silence about cost reads as free.
    expect(items().join(' ')).toContain('free');
  });

  it('does not offer it again once the profile has it', () => {
    open(profile({ taxStatus: 'ready' }));
    const text = items().join(' | ');
    expect(text).not.toContain('Add tax detail');
    expect(text).toContain('Tax detail included');
    expect((screen.getByRole('menuitem', { name: /Tax detail included/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('says a running search is already paid for, and that checking is free', () => {
    open(profile({ taxStatus: 'pending' }));
    const item = screen.getByRole('menuitem', { name: /Tax search running/ });
    expect(item.textContent).toContain('Already paid for');
    expect(item.textContent).toContain('never starts a second search');
  });

  it('offers nothing on a denied county, and says a retry will not help', () => {
    open(profile({ taxStatus: 'denied' }));
    const text = items().join(' | ');
    expect(text).not.toContain('Add tax detail');
    expect(text).toContain('not entitled');
    expect(text).toContain('Nothing was charged');
  });

  it('offers nothing when the county holds no record', () => {
    open(profile({ taxStatus: 'empty' }));
    const text = items().join(' | ');
    expect(text).not.toContain('Add tax detail');
    expect(text).toContain('found nothing for this parcel');
  });

  it('offers a priced retry after a failed create, which charged nothing', () => {
    open(profile({ taxStatus: 'failed' }));
    const item = screen.getByRole('menuitem', { name: /Retry tax detail/ });
    expect(item.textContent).toContain('one search');
    expect(item.textContent).toContain('before anything was charged');
  });

  it('posts to the tax route once and reports what came back', async () => {
    const f = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, taxStatus: 'pending', titlePointCharges: 1, message: 'The tax search is running.' }),
    });
    vi.stubGlobal('fetch', f);

    open(profile({ id: 42, taxStatus: null }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Add tax detail/ }));

    await waitFor(() => expect(f).toHaveBeenCalledTimes(1));
    expect(f.mock.calls[0]![0]).toBe('/api/concierge/profiles/42/tax');
    expect(f.mock.calls[0]![1]).toMatchObject({ method: 'POST' });
    await waitFor(() => expect(items().join(' ')).toContain('The tax search is running.'));
  });

  it('is honest that a network failure may still have started a paid search', async () => {
    // Saying "nothing was charged" here would be a guess: the request may have
    // reached the server. The row's own status is the answer.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    open(profile({ id: 42, taxStatus: null }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Add tax detail/ }));
    await waitFor(() => expect(items().join(' ')).toContain('may or may not have started'));
  });

  it('is not offered on a farming report at all', () => {
    open(row());
    expect(items().join(' | ')).not.toContain('tax');
  });
});
