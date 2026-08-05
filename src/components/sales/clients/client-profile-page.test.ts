import { describe, expect, it } from 'vitest';
import { shouldShowSignalDetail } from './client-profile-page';

describe('shouldShowSignalDetail', () => {
  it('hides the line when it repeats the snapshot’s basis', () => {
    // The real case: a momentum chip sourced from the 90-day trend carries the
    // trend's own basis, which the health snapshot already prints.
    const basis = '47 orders in the last 90 days vs 29 in the 90 before';
    expect(shouldShowSignalDetail(basis, basis)).toBe(false);
  });

  it('ignores a trailing period difference', () => {
    // The snapshot renders "<basis>." while the signal carries it bare.
    expect(shouldShowSignalDetail(
      '47 orders in the last 90 days vs 29 in the 90 before',
      '47 orders in the last 90 days vs 29 in the 90 before.',
    )).toBe(false);
  });

  it('shows a genuinely different explanation', () => {
    expect(shouldShowSignalDetail(
      'Usually ~6/mo, nothing in 41 days.',
      '2 orders in the last 90 days vs 9 in the 90 before',
    )).toBe(true);
  });

  it('shows the month-to-date framing, which the snapshot does not carry', () => {
    expect(shouldShowSignalDetail(
      '4 this month vs ~2/mo average.',
      '12 orders in the last 90 days vs 10 in the 90 before',
    )).toBe(true);
  });

  it('renders nothing when there is no detail', () => {
    expect(shouldShowSignalDetail(null, 'anything')).toBe(false);
    expect(shouldShowSignalDetail('', 'anything')).toBe(false);
  });
});
