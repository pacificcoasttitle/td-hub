// @vitest-environment jsdom
import '@/test-support/interactive-timeout';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NewReportModal } from './new-report-modal';

// ─── A spend must not survive a cancel ──────────────────────────────────────
//
// The tax detail is an opt-in second purchase. The dialog that carries it is
// remounted on every open, which is what normally guarantees a tick cannot
// pre-arm the next generation — but the POST it controls happens after the
// dialog is gone, so the flag has to live in the modal, outside the remount.
// openGate() resets it by hand, and this is the test that the reset is real.
//
// It drives the whole modal rather than the gate alone, because the hazard lives
// in the SEAM between them: the gate is correct in isolation either way.

afterEach(cleanup);

/** Every endpoint the modal touches on this path, answered from one place. */
function stubApi(over: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const bodies: Record<string, unknown> = {
    '/api/concierge/access': { canGenerate: true, featureOn: true },
    '/api/reports/access': { farming: false },
    '/api/concierge/reps': { reps: [{ id: 412, label: 'Justin Nouri', name: 'Justin Nouri', email: 'j@pct.com', company: 'PCT', detail: null, hasLogin: true }] },
    '/api/concierge/prepared-for': { results: [] },
    '/api/concierge/spend': { thisMonth: 3, allTime: 6 },
    '/api/concierge/for-property': {},
    '/api/concierge/profiles': { profileId: 9 },
    ...over,
  };
  // LONGEST PREFIX WINS. Plain startsWith made '/api/concierge/profiles' swallow
  // '/api/concierge/profiles/9/tax', so the tax route answered with the generate
  // route's body — and a test asserting "two tax calls" passed because the stub
  // had made the first one look unfinished. A stub that answers the wrong route
  // is worse than no stub: every assertion downstream is about fiction.
  const keys = Object.keys(bodies).sort((a, b) => b.length - a.length);
  const f = vi.fn(async (url: string, _init?: RequestInit) => {
    calls.push(url);
    const key = keys.find((k) => url.startsWith(k));
    return { ok: true, json: async () => (key ? bodies[key] : {}) };
  });
  vi.stubGlobal('fetch', f);
  return { calls, fetchMock: f };
}

beforeEach(() => { vi.unstubAllGlobals(); });

/** Type step → details step → fill the address and rep → open the gate. */
async function reachTheGate() {
  render(<NewReportModal onClose={() => {}} onCreated={() => {}} />);

  await waitFor(() => expect(screen.getByText('Concierge Profile')).toBeTruthy());
  fireEvent.click(screen.getByText('Concierge Profile'));
  fireEvent.click(screen.getByRole('button', { name: /^Continue$/ }));

  await waitFor(() => expect(screen.getByLabelText('Presenting representative')).toBeTruthy());

  const street = screen.getByPlaceholderText(/Start typing an address/i);
  fireEvent.change(street, { target: { value: '1358 5th St' } });
  fireEvent.change(screen.getByLabelText('City'), { target: { value: 'La Verne' } });
  fireEvent.change(screen.getByLabelText('ZIP'), { target: { value: '91750' } });

  const rep = screen.getByLabelText('Presenting representative');
  fireEvent.focus(rep);
  await waitFor(() => expect(screen.queryAllByRole('option').length).toBeGreaterThan(0));
  fireEvent.pointerDown(screen.getAllByRole('option')[0]!);

  fireEvent.click(screen.getByRole('button', { name: /Continue|Generate/i }));
  await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());

  // Generate is blocked without a prepared-for, so every test that reaches the
  // confirm button needs this. Leaving it out made the first run look like "the
  // POST never fired" when the button was simply disabled.
  fireEvent.change(screen.getByLabelText('Prepared for'), { target: { value: 'Dana Whitfield' } });
}

/**
 * BY NAME, not by position. The details step behind this dialog has its own
 * checkboxes — "Same property type only" and five "Any" toggles on the criteria
 * sliders — and sameUseCode defaults to ticked, so the first checkbox in the
 * document is not this one and the first version of these tests was reading it.
 */
const taxBox = () => screen.getByRole('checkbox', { name: /Add property tax detail/i }) as HTMLInputElement;

describe('a ticked tax search cannot survive a cancel', () => {
  it('opens unticked, and opens unticked again after a cancel with it ticked', async () => {
    stubApi();
    await reachTheGate();

    expect(taxBox().checked).toBe(false);

    // Tick it, then back out.
    fireEvent.click(taxBox());
    expect(taxBox().checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /^Cancel$/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // Reopen. THIS is the bug the reset prevents: without it the next
    // generation carries a charge nobody asked for on this pass.
    fireEvent.click(screen.getByRole('button', { name: /Continue|Generate/i }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    expect(taxBox().checked).toBe(false);
  });

  it('does not call the tax route when the box is left alone', async () => {
    const { calls } = stubApi();
    await reachTheGate();

    fireEvent.click(screen.getByRole('button', { name: /Generate profile/i }));
    await waitFor(() => expect(calls.some((u) => u === '/api/concierge/profiles')).toBe(true));

    expect(calls.some((u) => u.includes('/tax'))).toBe(false);
  });

  it('buys the tax search then waits for it, after the profile exists', async () => {
    // TWO calls to one route, and that is the design: the first buys the
    // search, the second finishes it inside a request somebody is waiting on —
    // rather than in a promise fired after the response, which is what died on
    // profile 9. Measured median is 2.4s, so the wait is short.
    // The real sequence: creating the search answers 'pending' — it has been
    // accepted, not finished — and the second call is what polls and renders.
    const calls: string[] = [];
    let taxCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url);
      if (url.includes('/tax')) {
        taxCalls += 1;
        return taxCalls === 1
          ? { ok: true, json: async () => ({ ok: true, taxStatus: 'pending', titlePointCharges: 1, message: 'running' }) }
          : { ok: true, json: async () => ({ ok: true, taxStatus: 'ready', titlePointCharges: 0, message: 'done' }) };
      }
      if (url.startsWith('/api/concierge/access')) return { ok: true, json: async () => ({ canGenerate: true, featureOn: true }) };
      if (url.startsWith('/api/reports/access')) return { ok: true, json: async () => ({ farming: false }) };
      if (url.startsWith('/api/concierge/reps')) return { ok: true, json: async () => ({ reps: [{ id: 412, label: 'Justin Nouri', name: 'Justin Nouri', email: null, company: null, detail: null, hasLogin: true }] }) };
      if (url.startsWith('/api/concierge/profiles')) return { ok: true, json: async () => ({ profileId: 9 }) };
      return { ok: true, json: async () => ({}) };
    }));

    await reachTheGate();

    fireEvent.click(taxBox());
    fireEvent.click(screen.getByRole('button', { name: /Generate profile/i }));

    await waitFor(() => expect(calls.filter((u) => u.includes('/tax'))).toHaveLength(2));
    // Finished cleanly, so no notice and the modal is free to close.
    expect(screen.queryByText(/taking longer than usual/i)).toBeNull();

    // The profile id from the generate response, not a guess — and AFTER it.
    expect(calls.filter((u) => u.includes('/tax')))
      .toEqual(['/api/concierge/profiles/9/tax', '/api/concierge/profiles/9/tax']);
    expect(calls.indexOf('/api/concierge/profiles')).toBeLessThan(calls.findIndex((u) => u.includes('/tax')));
  });

  it('does not hold the operator when the search is already finished', async () => {
    // A county with nothing on record answers 'empty' on the first call. There
    // is nothing to wait for, so there is no second call and no spinner.
    const { calls } = stubApi({
      '/api/concierge/profiles/9/tax': { ok: true, taxStatus: 'empty', titlePointCharges: 1, message: 'no record' },
    });
    await reachTheGate();
    fireEvent.click(taxBox());
    fireEvent.click(screen.getByRole('button', { name: /Generate profile/i }));

    await waitFor(() => expect(calls.some((u) => u.includes('/tax'))).toBe(true));
    expect(calls.filter((u) => u.includes('/tax'))).toHaveLength(1);
  });

  it('stops waiting and says the document will update itself', async () => {
    // The finish call never resolves. The operator must not be held, and must
    // not be told the report failed — it did not, and the search is paid for.
    let settle: (v: unknown) => void = () => {};
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url);
      if (url.includes('/tax')) {
        const n = calls.filter((u) => u.includes('/tax')).length;
        if (n === 1) return { ok: true, json: async () => ({ ok: true, taxStatus: 'pending', message: 'running' }) };
        return new Promise((r) => { settle = r; });
      }
      if (url.startsWith('/api/concierge/access')) return { ok: true, json: async () => ({ canGenerate: true, featureOn: true }) };
      if (url.startsWith('/api/reports/access')) return { ok: true, json: async () => ({ farming: false }) };
      if (url.startsWith('/api/concierge/reps')) return { ok: true, json: async () => ({ reps: [{ id: 412, label: 'Justin Nouri', name: 'Justin Nouri', email: null, company: null, detail: null, hasLogin: true }] }) };
      if (url.startsWith('/api/concierge/profiles')) return { ok: true, json: async () => ({ profileId: 9 }) };
      return { ok: true, json: async () => ({}) };
    }));

    await reachTheGate();
    fireEvent.click(taxBox());
    fireEvent.click(screen.getByRole('button', { name: /Generate profile/i }));

    // The spinner says what is happening, and claims no position — see the gate.
    await waitFor(() => expect(screen.getByText(/Searching county tax records/i)).toBeTruthy());
    expect(screen.queryByRole('progressbar')).toBeNull();

    // The ceiling is 15s of real time, so rather than wait it out, let the
    // request fail the way an abort does and assert the handling.
    settle({ ok: false, status: 504, json: async () => null });
    await waitFor(() => expect(screen.getByText(/taking longer than usual/i)).toBeTruthy());
    expect(screen.getByText(/will finish on its own/i)).toBeTruthy();
    // Not reported as a failed report, because it is not one.
    expect(screen.getByText('The profile was created. The tax search was not started.')).toBeTruthy();
  });

  it('says so when the tax search could not be started, instead of closing silently', async () => {
    // CHANGED 2026-10-05, and it is the whole point of the fix. This used to
    // assert that the modal closed anyway: the call was `void fetch(...)
    // .catch(() => {})` followed immediately by onClose(), which is
    // unfalsifiable — not awaited, unmounted underneath, every error discarded.
    // The comment defending it said the row's tax status would report the
    // problem, but a request that never lands creates no row, so that channel
    // does not exist. Tick, close, silence. Which is what Gerard saw.
    //
    // The profile IS still fine, so the notice says both halves and the report
    // is handed to the list regardless.
    const onClose = vi.fn();
    const onCreated = vi.fn();
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url);
      if (url.includes('/tax')) throw new Error('offline');
      if (url.startsWith('/api/concierge/access')) return { ok: true, json: async () => ({ canGenerate: true, featureOn: true }) };
      if (url.startsWith('/api/reports/access')) return { ok: true, json: async () => ({ farming: false }) };
      if (url.startsWith('/api/concierge/reps')) return { ok: true, json: async () => ({ reps: [{ id: 412, label: 'Justin Nouri', name: 'Justin Nouri', email: null, company: null, detail: null, hasLogin: true }] }) };
      if (url.startsWith('/api/concierge/profiles')) return { ok: true, json: async () => ({ profileId: 9 }) };
      return { ok: true, json: async () => ({}) };
    }));

    render(<NewReportModal onClose={onClose} onCreated={onCreated} />);
    await waitFor(() => expect(screen.getByText('Concierge Profile')).toBeTruthy());
    fireEvent.click(screen.getByText('Concierge Profile'));
    fireEvent.click(screen.getByRole('button', { name: /^Continue$/ }));
    await waitFor(() => expect(screen.getByLabelText('Presenting representative')).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText(/Start typing an address/i), { target: { value: '1358 5th St' } });
    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'La Verne' } });
    fireEvent.change(screen.getByLabelText('ZIP'), { target: { value: '91750' } });
    const rep = screen.getByLabelText('Presenting representative');
    fireEvent.focus(rep);
    await waitFor(() => expect(screen.queryAllByRole('option').length).toBeGreaterThan(0));
    fireEvent.pointerDown(screen.getAllByRole('option')[0]!);
    fireEvent.click(screen.getByRole('button', { name: /Continue|Generate/i }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Prepared for'), { target: { value: 'Dana Whitfield' } });

    fireEvent.click(taxBox());
    fireEvent.click(screen.getByRole('button', { name: /Generate profile/i }));

    // The notice appears and the modal STAYS OPEN. A close here is the silence.
    await waitFor(() => expect(screen.getByText(/The tax search was not started/i)).toBeTruthy());
    expect(onClose).not.toHaveBeenCalled();

    // It says the report is fine, so nobody reads this as a failed generation.
    expect(screen.getByText('The profile was created. The tax search was not started.')).toBeTruthy();
    // And where to do the thing that did not happen.
    expect(screen.getByText(/row in Reports/i)).toBeTruthy();
    // The row still reaches the list — the profile exists and was paid for.
    expect(onCreated).toHaveBeenCalledWith(9);

    // Dismissing is what closes it, so the operator has to have seen it.
    fireEvent.click(screen.getByRole('button', { name: /Understood/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('sends the tax request with keepalive, so the close cannot cancel it', async () => {
    // The modal unmounts immediately after. Without keepalive the browser is
    // free to abort an in-flight request from a document that is going away,
    // which is one of the ways "I ticked it and nothing happened" happens.
    const { calls, fetchMock } = stubApi();
    await reachTheGate();
    fireEvent.click(taxBox());
    fireEvent.click(screen.getByRole('button', { name: /Generate profile/i }));

    await waitFor(() => expect(calls.some((u) => u.includes('/tax'))).toBe(true));
    const taxCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/tax'))!;
    expect(taxCall[1]).toMatchObject({ method: 'POST', keepalive: true });
  });
});
