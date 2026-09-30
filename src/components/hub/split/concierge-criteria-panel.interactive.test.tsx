// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConciergeCriteriaPanel } from './concierge-criteria-panel';
import { DEFAULT_CRITERIA, type CompCriteria } from '@/lib/domain/concierge/comp-filter';
import type { ProfileSummary } from '@/lib/domain/concierge/profiles';

// ─── The first test in this repo that can drive a component ─────────────────
//
// Before this, 12 .test.tsx files existed and NONE could click, type or
// trigger a state update: ten call renderToStaticMarkup, which runs a
// component once and reads its first paint, and two only read source.
//
// 2C is what that costs. The criteria control rendered perfectly and lost the
// operator's changes when three slider events landed in one tick — a defect
// that lives entirely in the gap between "first paint" and "somebody used it".
//
// jsdom is opted into PER FILE with the docblock above, not globally: the
// other ~270 test files are node-environment and stay that way, so this costs
// them nothing. vitest.config.ts is untouched.

afterEach(cleanup);

const profile = (over: Partial<ProfileSummary> = {}): ProfileSummary => ({
  id: 4, orderId: null, status: 'generated', requestedAddress: '1358 5th St',
  subjectAddressLine: '1358 5TH ST, LA VERNE, CA 91750',
  createdAt: '2026-09-24 21:14:00', createdBy: 'ops@pct.com', errorMessage: null,
  hasPdf: true, pdfBytes: 1_200_000, pdfPageCount: 8,
  compsReturned: 25, compsQualified: 4, compsShown: 4,
  criteria: { ...DEFAULT_CRITERIA, radiusMiles: 1, months: 12, maxComps: 12 },
  creditsCharged: 1, sitexSearchId: 1408916630, canRenderFree: true,
  ...over,
});

/** The range inputs, in the order the panel lays them out. */
const sliders = () => screen.getAllByRole('slider') as HTMLInputElement[];

describe('the panel sends what the operator actually set', () => {
  it('keeps EVERY change when several sliders move before Apply', () => {
    // This asserts the panel accumulates changes. It does NOT reproduce the
    // reported "does nothing" defect — the captured-spread idiom passes it
    // too, which is how that diagnosis was found to be wrong. See
    // stale-closure-probe.test.tsx.
    //
    // Worth keeping regardless: it is the property an operator depends on,
    // and nothing else in the repo asserted it.
    const onApply = vi.fn();
    render(<ConciergeCriteriaPanel profile={profile()} busy={false} error={null} onClose={() => {}} onApply={onApply} />);

    const [livingArea, beds, baths, radius] = sliders();

    // ONE act(), FOUR EVENTS. This is the whole test.
    //
    // Calling fireEvent four times wraps each in its own act(), so React
    // re-renders between them and the captured `c` is never stale — the first
    // version of this test passed against the buggy code. A dragged range
    // input does not behave that way: its events land in one task and React
    // batches them, which is when every handler spreads the same object.
    act(() => {
      for (const [el, value] of [[livingArea, '45'], [beds, '3'], [baths, '2'], [radius, '2.5']] as const) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!
          .set!.call(el, value);
        el!.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    fireEvent.click(screen.getByRole('button', { name: /re-render/i }));

    expect(onApply).toHaveBeenCalledTimes(1);
    const sent = onApply.mock.calls[0]![0] as CompCriteria;
    expect(sent.livingAreaPct, 'the first change was lost — a later write spread a stale object').toBe(45);
    expect(sent.bedDelta).toBe(3);
    expect(sent.bathDelta).toBe(2);
    expect(sent.radiusMiles).toBe(2.5);
  });

  it('sends the profile’s own criteria when nothing is touched', () => {
    const onApply = vi.fn();
    const p = profile();
    render(<ConciergeCriteriaPanel profile={p} busy={false} error={null} onClose={() => {}} onApply={onApply} />);
    fireEvent.click(screen.getByRole('button', { name: /re-render/i }));
    expect(onApply.mock.calls[0]![0]).toEqual(p.criteria);
  });

  it('turning a filter off sends null, which is not zero', () => {
    // null means "do not apply this filter"; 0 would exclude everything.
    const onApply = vi.fn();
    render(<ConciergeCriteriaPanel profile={profile()} busy={false} error={null} onClose={() => {}} onApply={onApply} />);

    const anyBoxes = screen.getAllByRole('checkbox').filter((el) => el.closest('label')?.textContent?.includes('Any'));
    expect(anyBoxes.length, 'no "Any" checkboxes found — this test is not exercising anything').toBeGreaterThan(0);
    fireEvent.click(anyBoxes[0]!);

    fireEvent.click(screen.getByRole('button', { name: /re-render/i }));
    const sent = onApply.mock.calls[0]![0] as CompCriteria;
    expect(Object.values(sent)).toContain(null);
  });

  it('does not apply while a render is already running', () => {
    const onApply = vi.fn();
    render(<ConciergeCriteriaPanel profile={profile()} busy error={null} onClose={() => {}} onApply={onApply} />);
    fireEvent.click(screen.getByRole('button', { name: /re-render/i }));
    expect(onApply).not.toHaveBeenCalled();
  });
});
