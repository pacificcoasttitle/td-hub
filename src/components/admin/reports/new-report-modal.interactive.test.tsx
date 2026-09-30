// @vitest-environment jsdom
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
  const f = vi.fn(async (url: string) => {
    calls.push(url);
    const key = Object.keys(bodies).find((k) => url.startsWith(k));
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

  it('calls the tax route once, after the profile exists, when it is ticked', async () => {
    const { calls } = stubApi();
    await reachTheGate();

    fireEvent.click(taxBox());
    fireEvent.click(screen.getByRole('button', { name: /Generate profile/i }));

    await waitFor(() => expect(calls.some((u) => u.includes('/tax'))).toBe(true));

    // The profile id from the generate response, not a guess — and AFTER it.
    expect(calls.filter((u) => u.includes('/tax'))).toEqual(['/api/concierge/profiles/9/tax']);
    expect(calls.indexOf('/api/concierge/profiles')).toBeLessThan(calls.findIndex((u) => u.includes('/tax')));
  });

  it('still closes when the tax call fails, because the profile is complete', async () => {
    // The profile is generated, paid for, and renders its tax page from the
    // assessment detail SiteX already gave us. A failed second purchase must not
    // report the report as broken.
    const onClose = vi.fn();
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

    render(<NewReportModal onClose={onClose} onCreated={() => {}} />);
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

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(screen.queryByText(/Network error/i)).toBeNull();
  });
});
