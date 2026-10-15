// @vitest-environment jsdom
import '@/test-support/interactive-timeout';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConciergeCostGate, type CostGateProps } from './concierge-cost-gate';

// ─── The gate spends money, so its guards are driven, not read ──────────────
//
// Four properties were only ever asserted by reading the source before this:
// Cancel takes focus, Enter never confirms, Confirm is disabled in flight, and
// Escape cancels. All four are statements about what happens when somebody uses
// it, which is precisely what renderToStaticMarkup cannot see.
//
// The fifth is new and is the reason this file exists now: the tax detail is an
// opt-in second purchase, and it must be off unless this dialog was told
// otherwise on THIS pass.

afterEach(cleanup);
beforeEach(() => {
  // PreparedForField fetches its suggestions on mount.
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [] }) }));
});

const props = (over: Partial<CostGateProps> = {}): CostGateProps => ({
  address: '1358 5th St, La Verne, CA 91750',
  preparedForName: 'Dana Whitfield',
  preparedForCompany: '',
  presentingRepName: 'Justin Nouri',
  presentingRepProblem: null,
  criteriaSummary: 'within 1 mi · sold in 12 months · up to 12',
  spend: null,
  submitting: false,
  error: null,
  taxDetail: false,
  onTaxDetail: () => {},
  // The hazard preview is free, so it defaults ON in the modal. These
  // existing tests are about the TAX control, so the default here keeps
  // it available and ticked — a hidden control cannot be asserted about.
  hazard: true,
  onHazard: () => {},
  hazardAvailable: true,
  onPreparedForName: () => {},
  onPreparedForCompany: () => {},
  onCancel: () => {},
  onConfirm: () => {},
  ...over,
});

const confirmButton = () => screen.getByRole('button', { name: /Generate profile/i });
// TWO checkboxes since 2026-10-15 — tax and the free hazard preview — so
// these are selected by their accessible name rather than by role alone.
// getByRole('checkbox') now throws "found multiple elements", which is the
// right failure: a test that silently picked the first one would start
// asserting the wrong control the next time the order changes.
const taxBox = () => screen.getByRole('checkbox', { name: /tax detail/i });
const hazardBox = () => screen.getByRole('checkbox', { name: /hazard preview/i });

describe('the tax detail is opt-in and says what it costs', () => {
  it('is unticked when the dialog opens', () => {
    render(<ConciergeCostGate {...props()} />);
    expect((taxBox() as HTMLInputElement).checked).toBe(false);
  });

  it('names the charge rather than calling it a formatting choice', () => {
    render(<ConciergeCostGate {...props()} />);
    // "Include taxes" reads as a layout option. This is a second purchase from a
    // second vendor and the label has to say so.
    expect(screen.getByText(/Add property tax detail/i)).toBeTruthy();
    expect(screen.getByText(/one additional search/i)).toBeTruthy();
  });

  it('says what NOT ticking costs, which is nothing', () => {
    render(<ConciergeCostGate {...props()} />);
    // An opt-in that reads as "or go without a tax page" gets ticked every time,
    // and then it is not an opt-in.
    expect(screen.getByText(/the tax page still shows the assessment detail this lookup already includes/i)).toBeTruthy();
  });

  it('reports the tick upward rather than holding it', () => {
    const onTaxDetail = vi.fn();
    render(<ConciergeCostGate {...props({ onTaxDetail })} />);
    fireEvent.click(taxBox());
    expect(onTaxDetail).toHaveBeenCalledWith(true);
  });

  it('does not block Generate either way', () => {
    // It changes what is bought, not whether the profile can be.
    render(<ConciergeCostGate {...props({ taxDetail: false })} />);
    expect((confirmButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it('is disabled in flight, like every other control that affects a spend', () => {
    render(<ConciergeCostGate {...props({ submitting: true })} />);
    expect((taxBox() as HTMLInputElement).disabled).toBe(true);
  });
});

describe('the four guards that were only ever read, not driven', () => {
  it('puts focus on Cancel, never on the button that spends', () => {
    render(<ConciergeCostGate {...props()} />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Cancel$/ }));
  });

  it('never confirms on Enter', () => {
    const onConfirm = vi.fn();
    render(<ConciergeCostGate {...props({ onConfirm })} />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter' });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('cancels on Escape', () => {
    const onCancel = vi.fn();
    render(<ConciergeCostGate {...props({ onCancel })} />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('does not cancel on Escape while a generation is in flight', () => {
    // The credit is already being spent; closing the dialog would hide the
    // outcome of a purchase that is happening.
    const onCancel = vi.fn();
    render(<ConciergeCostGate {...props({ onCancel, submitting: true })} />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('disables Confirm in flight, so a double-click cannot double-spend', () => {
    render(<ConciergeCostGate {...props({ submitting: true })} />);
    expect((screen.getByRole('button', { name: /Generating/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('blocks Generate with no prepared-for and no rep', () => {
    render(<ConciergeCostGate {...props({ preparedForName: '' })} />);
    expect((confirmButton() as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    render(<ConciergeCostGate {...props({ presentingRepName: '' })} />);
    expect((confirmButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it('has no acknowledgement tick — every checkbox here changes what happens', () => {
    // Removed 2026-09-30. All five duplicate profiles on one parcel were
    // generated WITH it ticked, which is the whole argument: a box that only
    // confirms a decision already made gets ticked every time and protects
    // nothing.
    //
    // THIS USED TO ASSERT "exactly one checkbox", and a second legitimate
    // control broke it on 2026-10-15. The count was a proxy for the rule, and
    // the rule is that every box on this dialog CHANGES WHAT HAPPENS. So the
    // boxes are enumerated by their accessible name: a third one that does
    // something still passes, and an acknowledgement tick fails whatever the
    // count.
    render(<ConciergeCostGate {...props()} />);
    const names = screen.getAllByRole('checkbox')
      .map((el) => el.getAttribute('aria-label')
        ?? el.closest('label')?.textContent?.trim().slice(0, 40) ?? '(unnamed)');
    for (const n of names) {
      expect(n, `a checkbox reading "${n}" does not say what it does`).toMatch(/tax detail|hazard preview/i);
    }
    expect(screen.queryByText(/I have checked/i)).toBeNull();
    expect(screen.queryByText(/I confirm|I acknowledge|I understand/i)).toBeNull();
  });
});
