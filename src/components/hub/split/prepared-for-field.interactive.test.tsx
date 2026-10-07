// @vitest-environment jsdom
import '@/test-support/interactive-timeout';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PreparedForField } from './prepared-for-field';

// ─── Suggestions must not become a picker ───────────────────────────────────
//
// The failure mode this guards against is the field becoming required to match
// something. A prepared-for name is whoever the operator is sending the profile
// to, and the first one they send to a new client must be typeable. So the
// assertions below are mostly about what still works when the suggestions are
// absent, empty, or wrong.

afterEach(cleanup);
beforeEach(() => { vi.unstubAllGlobals(); });

// The list is pooled across the company and ranked own-first, so a realistic
// response has both: one of the operator's own, and one of somebody else's.
const RESULTS = [
  { name: 'Dana Whitfield', company: 'Coldwell Banker', used: 4, lastUsed: '2026-09-22', mine: true },
  { name: 'Marcus Whitfield', company: null, used: 1, lastUsed: '2026-08-02', mine: false },
];

function stubFetch(body: unknown, ok = true) {
  const f = vi.fn().mockResolvedValue({ ok, json: async () => body });
  vi.stubGlobal('fetch', f);
  return f;
}

const box = () => screen.getByRole('combobox') as HTMLInputElement;
const options = () => screen.queryAllByRole('option');

/**
 * Controlled, like the real gate — otherwise typing does nothing and every
 * assertion below passes for the wrong reason.
 */
function Harness({ onName }: { onName?: (v: string) => void } = {}) {
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  return (
    <PreparedForField
      name={name}
      company={company}
      onName={(v) => { setName(v); onName?.(v); }}
      onCompany={setCompany}
    />
  );
}

describe('a name nobody has used before', () => {
  it('accepts free text with no suggestion at all', async () => {
    stubFetch({ results: [] });
    const onName = vi.fn();
    render(<Harness onName={onName} />);

    fireEvent.change(box(), { target: { value: 'Priya Raghunathan' } });

    // The input IS the field. Nothing has to be selected.
    expect(box().value).toBe('Priya Raghunathan');
    expect(onName).toHaveBeenLastCalledWith('Priya Raghunathan');
  });

  it('keeps working when the suggestion endpoint fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    render(<Harness />);

    fireEvent.change(box(), { target: { value: 'Priya' } });
    await waitFor(() => expect(box().value).toBe('Priya'));

    // Silent by design: a broken suggestion list costs the operator nothing.
    expect(screen.queryByText(/could not/i)).toBeNull();
  });
});

describe('a name the operator has used before', () => {
  it('offers their own history on focus, before typing', async () => {
    stubFetch({ results: RESULTS });
    render(<Harness />);
    await waitFor(() => expect(screen.queryAllByRole('option').length).toBe(0));

    fireEvent.focus(box());
    await waitFor(() => expect(options().length).toBe(2));
    expect(options().map((o) => o.textContent)).toContain('Dana WhitfieldColdwell Banker · 4 profiles');
  });

  it('fills the brokerage when a suggestion is picked', async () => {
    stubFetch({ results: RESULTS });
    render(<Harness />);

    fireEvent.focus(box());
    await waitFor(() => expect(options().length).toBe(2));
    fireEvent.pointerDown(options()[0]!);

    expect(box().value).toBe('Dana Whitfield');
    expect((screen.getByLabelText('Brokerage') as HTMLInputElement).value).toBe('Coldwell Banker');
  });

  it('leaves the brokerage alone when the name is typed by hand', async () => {
    stubFetch({ results: RESULTS });
    render(<Harness />);

    fireEvent.change((screen.getByLabelText('Brokerage') as HTMLInputElement), { target: { value: 'Compass' } });
    fireEvent.change(box(), { target: { value: 'Dana Whitfield' } });

    expect((screen.getByLabelText('Brokerage') as HTMLInputElement).value).toBe('Compass');
  });

  it('shows the count that explains the ranking, and only where it means something', async () => {
    stubFetch({ results: RESULTS });
    render(<Harness />);

    fireEvent.focus(box());
    await waitFor(() => expect(options().length).toBe(2));

    const rows = options().map((o) => o.textContent ?? '');
    // Four profiles is a client. One is as likely a typo, and "1 profiles"
    // would be both wrong and noise.
    expect(rows[0]).toContain('4 profiles');
    expect(rows[1]).not.toContain('profiles');
  });

  it('scopes nothing by a parameter — the operator is the session', async () => {
    const f = stubFetch({ results: RESULTS });
    render(<Harness />);
    await waitFor(() => expect(f).toHaveBeenCalled());

    const url = String(f.mock.calls[0]![0]);
    expect(url.startsWith('/api/concierge/prepared-for?q=')).toBe(true);
    // A createdBy in the query string would let one rep read another's book.
    expect(url).not.toMatch(/createdBy|user|email/i);
  });
});

describe('a pooled list says whose name it is', () => {
  it('marks somebody else’s entry and leaves your own unlabelled', async () => {
    // The count stopped being a statement about you when the list went
    // company-wide, so an unfamiliar name with "4 profiles" would otherwise
    // read as four of yours. Your own say nothing extra — they are already at
    // the top, and labelling the common case is noise.
    stubFetch({ results: RESULTS });
    render(<Harness />);
    fireEvent.focus(box());
    await waitFor(() => expect(options().length).toBe(2));

    const rows = options().map((o) => o.textContent ?? '');
    expect(rows[0]).toContain('Dana Whitfield');
    expect(rows[0]).not.toContain('used by the team');
    expect(rows[1]).toContain('Marcus Whitfield');
    expect(rows[1]).toContain('used by the team');
  });

  it('still fills the brokerage from a colleague’s entry', async () => {
    // Pooling is pointless if the useful half is withheld.
    stubFetch({ results: [{ name: 'Priya Raghunathan', company: 'Compass', used: 2, lastUsed: '2026-10-01', mine: false }] });
    render(<Harness />);
    fireEvent.focus(box());
    await waitFor(() => expect(options().length).toBe(1));
    fireEvent.pointerDown(options()[0]!);

    expect(box().value).toBe('Priya Raghunathan');
    expect((screen.getByLabelText('Brokerage') as HTMLInputElement).value).toBe('Compass');
  });
});
