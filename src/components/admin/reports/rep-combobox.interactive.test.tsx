// @vitest-environment jsdom
import '@/test-support/interactive-timeout';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RepCombobox } from './rep-combobox';
import { labelReps, indistinguishable } from '@/lib/domain/concierge/rep-options';

// ─── Browsing 54 reps, and telling two Kevin Camerons apart ─────────────────
//
// The control this replaced was a search box that showed nothing until two
// characters were typed. These tests hold the two things that change: the whole
// list is reachable without typing, and a name held by two contacts is
// distinguishable on screen.
//
// jsdom per file, as in concierge-criteria-panel.interactive.test.tsx.

afterEach(cleanup);

/** The real shape: both Kevin Cameron rows share a name AND an email. */
const RAW = [
  { id: 412, name: 'Justin Nouri', email: 'jnouri@pct.com', company: 'PCT' },
  { id: 8, name: 'Kevin Cameron', email: 'kcameron@pct.com', company: null },
  { id: 22265, name: 'Kevin Cameron', email: 'kcameron@pct.com', company: null },
  { id: 900, name: 'Alma Reyes', email: 'areyes@pct.com', company: 'PCT' },
];

const served = () => labelReps(RAW).map((r) => ({
  ...r,
  // What the route adds from repTwinFacts. Only the duplicate pair gets one.
  detail: r.id === 8 ? 'Duplicate record — has login · 76 orders'
    : r.id === 22265 ? 'Duplicate record — NO login · 0 orders'
    : null,
  hasLogin: r.id !== 22265,
}));

function stubFetch(body: unknown, ok = true) {
  const f = vi.fn().mockResolvedValue({ ok, json: async () => body });
  vi.stubGlobal('fetch', f);
  return f;
}

beforeEach(() => { vi.unstubAllGlobals(); });

const mount = (over: Partial<Parameters<typeof RepCombobox>[0]> = {}) => {
  const onChoose = vi.fn();
  const onClear = vi.fn();
  const r = render(<RepCombobox chosenName="" onChoose={onChoose} onClear={onClear} {...over} />);
  return { ...r, onChoose, onClear };
};

const box = () => screen.getByRole('combobox') as HTMLInputElement;
const options = () => screen.queryAllByRole('option');

/**
 * The list has arrived. Plain property reads, not jest-dom matchers — this repo
 * does not install @testing-library/jest-dom and adding it for `toBeDisabled`
 * would be a dependency for sugar.
 */
const loaded = () => waitFor(() => expect(box().disabled).toBe(false));

describe('the whole list is reachable without typing', () => {
  it('shows every rep on focus, before a single keystroke', async () => {
    stubFetch({ reps: served() });
    mount();
    await loaded();

    // THE POINT OF THE CHANGE. The old control required two characters and
    // showed nothing at all until it had them.
    expect(options()).toHaveLength(0);
    fireEvent.focus(box());
    expect(options()).toHaveLength(4);
  });

  it('asks for the list once, not once per keystroke', async () => {
    const f = stubFetch({ reps: served() });
    mount();
    await loaded();

    fireEvent.focus(box());
    fireEvent.change(box(), { target: { value: 'k' } });
    fireEvent.change(box(), { target: { value: 'ke' } });
    fireEvent.change(box(), { target: { value: 'kev' } });

    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0]![0]).toBe('/api/concierge/reps');
  });

  it('filters on a surname, not only a prefix', async () => {
    stubFetch({ reps: served() });
    mount();
    await loaded();

    fireEvent.focus(box());
    fireEvent.change(box(), { target: { value: 'reyes' } });

    // A prefix match on the full name would find nothing here.
    expect(options().map((o) => o.textContent)).toEqual(['Alma Reyes']);
  });
});

describe('two contacts with one name', () => {
  it('renders the duplicates as two distinguishable rows', async () => {
    stubFetch({ reps: served() });
    mount();
    await loaded();

    fireEvent.focus(box());
    fireEvent.change(box(), { target: { value: 'cameron' } });

    const rows = options().map((o) => o.textContent ?? '');
    expect(rows).toHaveLength(2);

    // Each row must say something the other does not. This is the assertion
    // that the first labelReps() failed: it chose email as the distinguisher
    // because email was PRESENT, and both rows carry kcameron@pct.com, so both
    // rows read "Kevin Cameron · kcameron@pct.com".
    expect(rows[0]).not.toBe(rows[1]);

    // And the facts an operator can act on, which an id cannot give them.
    const joined = rows.join(' | ');
    expect(joined).toContain('has login · 76 orders');
    expect(joined).toContain('NO login · 0 orders');
  });

  it('labels every rep uniquely, asserted on the real shape', () => {
    // The guard for the guard, run rather than documented.
    expect(indistinguishable(labelReps(RAW))).toEqual([]);
  });

  it('falls all the way to the contact id when nothing else differs', () => {
    const labels = labelReps(RAW).filter((r) => r.name === 'Kevin Cameron').map((r) => r.label);
    expect(labels).toEqual(['Kevin Cameron · #8', 'Kevin Cameron · #22265']);
  });
});

describe('what reaches the draft', () => {
  it('stores the NAME, never the disambiguated label', async () => {
    stubFetch({ reps: served() });
    const { onChoose } = mount();
    await loaded();

    fireEvent.focus(box());
    fireEvent.change(box(), { target: { value: 'cameron' } });
    fireEvent.pointerDown(options()[0]!);

    expect(onChoose).toHaveBeenCalledTimes(1);
    const picked = onChoose.mock.calls[0]![0];
    // "Kevin Cameron · #8" is for choosing. The document prints this value on
    // its cover, where a contact id would read as part of the rep's name.
    expect(picked.name).toBe('Kevin Cameron');
    expect(picked.label).toBe('Kevin Cameron · #8');
    expect(picked.id).toBe(8);
  });

  it('picks with the keyboard as well as the pointer', async () => {
    stubFetch({ reps: served() });
    const { onChoose } = mount();
    await loaded();

    fireEvent.focus(box());
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    fireEvent.keyDown(box(), { key: 'Enter' });

    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(onChoose.mock.calls[0]![0].id).toBe(8);
  });

  it('closes the list on Escape without closing the dialog around it', async () => {
    stubFetch({ reps: served() });
    const onDialogEscape = vi.fn();
    render(
      <div onKeyDown={(e) => { if (e.key === 'Escape') onDialogEscape(); }}>
        <RepCombobox chosenName="" onChoose={() => {}} onClear={() => {}} />
      </div>,
    );
    await loaded();

    fireEvent.focus(box());
    expect(options()).toHaveLength(4);
    fireEvent.keyDown(box(), { key: 'Escape' });

    expect(options()).toHaveLength(0);
    // One step back, not two. The gate and the criteria panel both cancel on
    // Escape, and losing a half-filled dialog to a dismissed dropdown is the
    // kind of thing that makes an operator stop using the keyboard.
    expect(onDialogEscape).not.toHaveBeenCalled();
  });

  it('shows the chosen rep with a way to change it', () => {
    stubFetch({ reps: served() });
    mount({ chosenName: 'Justin Nouri' });
    expect(screen.getByText('Justin Nouri')).toBeTruthy();
    expect(screen.getByText('Change')).toBeTruthy();
    // No free text on this field: a rep must be a real contact id.
    expect(screen.queryByRole('combobox')).toBeNull();
  });
});

describe('when the list cannot be loaded', () => {
  it('says the generate is blocked rather than showing an empty list', async () => {
    stubFetch({}, false);
    mount();

    // "No sales representative by that name" against an empty book reads as
    // "there are none", which invites the operator to proceed without one.
    await waitFor(() => {
      expect(screen.getByText(/could not be loaded/i)).toBeTruthy();
    });
    expect(screen.getByText(/cannot be generated without a representative/i)).toBeTruthy();
  });
});
