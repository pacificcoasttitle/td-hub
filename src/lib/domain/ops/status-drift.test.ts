import { describe, expect, it } from 'vitest';
import {
  baselineFrom,
  classifyDrift,
  DETERIORATION_POINTS,
  driftPct,
  median,
  MIN_CHECKED_FOR_ALERT,
  MIN_RUNS_FOR_BASELINE,
  driftContext,
  smoothedCurrent,
  type DriftCounts,
} from './status-drift';

function counts(over: Partial<DriftCounts> = {}): DriftCounts {
  return { checked: 40, drifted: 10, unchecked: 0, notSampled: 0, ...over };
}

describe('driftPct', () => {
  it('divides by checked, not by the whole sample', () => {
    // 10 of 40 checked drifted; 20 more could not be checked and must not dilute it.
    expect(driftPct({ checked: 40, drifted: 10 })).toBe(25);
  });

  it('returns null rather than 0 when nothing was checked', () => {
    expect(driftPct({ checked: 0, drifted: 0 })).toBeNull();
  });
});

describe('median', () => {
  it('handles odd and even lengths', () => {
    expect(median([10, 30, 20])).toBe(20);
    expect(median([10, 20, 30, 40])).toBe(25);
  });
  it('returns null for an empty set', () => {
    expect(median([])).toBeNull();
  });
});

describe('baselineFrom', () => {
  it('needs at least two readings in its window', () => {
    expect(MIN_RUNS_FOR_BASELINE).toBe(2);
    expect(baselineFrom([])).toBeNull();
    expect(baselineFrom([24])).toBeNull();
    // The two newest are reserved for the smoothed current signal.
    expect(baselineFrom([99, 99, 24, 26])).toBe(25);
  });

  it('skips the readings folded into the smoothed current signal', () => {
    // If the baseline included the newest runs, a rise would drag the baseline
    // up with it and mask the trend.
    expect(baselineFrom([90, 90, 20, 20, 20])).toBe(20);
  });

  it('uses the median so one spike cannot drag the baseline up', () => {
    expect(baselineFrom([0, 0, 24, 25, 90, 23, 26])).toBe(25);
  });
});

describe('smoothedCurrent', () => {
  it('takes the median of the latest few readings', () => {
    expect(smoothedCurrent(10, [24, 22])).toBe(22);
  });

  it('is not thrown by one noisy run', () => {
    // Two real dev runs measured 24% and 10.8% on the same population; the
    // spread is sampling noise, and the median absorbs it.
    expect(smoothedCurrent(10.8, [24, 23])).toBe(23);
  });

  it('falls back gracefully with little history', () => {
    expect(smoothedCurrent(15, [])).toBe(15);
    expect(smoothedCurrent(15, [25])).toBe(20);
  });
});

describe('classifyDrift — the alarm is baseline-relative, the number never hides', () => {
  it('does not alarm on the known ~24% level once it is the baseline', () => {
    const v = classifyDrift(counts({ checked: 40, drifted: 10 }), [24, 25, 23, 24]);
    expect(v.status).toBe('steady');
    expect(v.alert).toBe(false);
    // The bad number is still reported, not suppressed.
    expect(v.driftPct).toBe(25);
    expect(v.summary).toContain('25%');
  });

  it('ALARMS when drift climbs meaningfully above the baseline', () => {
    // Baseline 24; three consecutive high readings, so the smoothed signal moves.
    const v = classifyDrift(counts({ checked: 40, drifted: 16 }), [40, 39, 24, 25, 23]);
    expect(v.status).toBe('deteriorating');
    expect(v.alert).toBe(true);
    expect(v.summary).toContain('getting worse');
  });

  it('treats a small wobble as noise, not deterioration', () => {
    // baseline 25, smoothed 30 → +5 points, under the 8-point floor.
    const v = classifyDrift(counts({ checked: 40, drifted: 12 }), [30, 30, 25, 25, 25]);
    expect(v.status).toBe('steady');
    expect(v.alert).toBe(false);
  });

  it('does NOT alarm on a single noisy spike — the expensive false positive', () => {
    // One 60% run against a settled 20% history. A single reading must not be
    // enough; a panel that cries wolf stops being read.
    const v = classifyDrift({ checked: 40, drifted: 24, unchecked: 0, notSampled: 0 }, [20, 19, 21, 20, 20]);
    expect(v.alert).toBe(false);
    expect(v.status).toBe('steady');
    // …but the spike is still visible in the displayed number.
    expect(v.driftPct).toBe(60);
  });

  it('alarms once the spike persists across runs', () => {
    const v = classifyDrift({ checked: 40, drifted: 24, unchecked: 0, notSampled: 0 }, [58, 61, 20, 20, 20]);
    expect(v.alert).toBe(true);
  });

  it('fires just past the deterioration margin and not just under it', () => {
    expect(DETERIORATION_POINTS).toBe(8);
    // Smoothed signal is held at exactly 28 by the two prior readings.
    const at = classifyDrift({ checked: 100, drifted: 28, unchecked: 0, notSampled: 0 }, [28, 28, 20, 20, 20]);
    expect(at.smoothedPct).toBe(28);
    expect(at.baselinePct).toBe(20);
    expect(at.alert).toBe(false);

    const past = classifyDrift({ checked: 100, drifted: 29, unchecked: 0, notSampled: 0 }, [29, 29, 20, 20, 20]);
    expect(past.smoothedPct).toBe(29);
    expect(past.alert).toBe(true);
  });

  it('never alarms before a baseline exists, but still shows the number', () => {
    const v = classifyDrift(counts({ checked: 40, drifted: 10 }), []);
    expect(v.status).toBe('no_baseline');
    expect(v.alert).toBe(false);
    expect(v.driftPct).toBe(25);
    expect(v.summary).toContain('25%');
  });

  it('follows the baseline back down after a fix, so a later climb re-alarms', () => {
    // Post-look-back-sync world: drift settled at ~2%.
    const afterFix = [2, 2, 3, 2, 2];
    expect(classifyDrift({ checked: 40, drifted: 1, unchecked: 0, notSampled: 0 }, afterFix).alert).toBe(false);
    // A sustained regression back to ~24% must alarm against the new low baseline.
    const regressed = classifyDrift({ checked: 40, drifted: 10, unchecked: 0, notSampled: 0 }, [24, 23, 3, 2, 2]);
    expect(regressed.alert).toBe(true);
    expect(regressed.status).toBe('deteriorating');
  });

  it('refuses to judge below the sample floor, and matches the vendor-health floor', () => {
    expect(MIN_CHECKED_FOR_ALERT).toBe(20);
    const v = classifyDrift({ checked: 5, drifted: 4, unchecked: 35, notSampled: 0 }, [10, 10, 10]);
    // 80% looks alarming but rests on 5 orders — report it, do not alarm on it.
    expect(v.status).toBe('low_sample');
    expect(v.alert).toBe(false);
    expect(v.driftPct).toBe(80);
  });

  it('says so plainly when nothing could be checked', () => {
    const v = classifyDrift({ checked: 0, drifted: 0, unchecked: 40, notSampled: 0 }, [24, 24]);
    expect(v.status).toBe('low_sample');
    expect(v.driftPct).toBeNull();
    expect(v.summary).toContain('No orders could be checked');
  });

  it('a run of all-timeouts cannot look like an improvement', () => {
    // The failure mode this guards: unchecked entering the denominator would
    // turn a bad SoftPro day into 0% drift and a false all-clear.
    const v = classifyDrift({ checked: 0, drifted: 0, unchecked: 40, notSampled: 0 }, [24, 24, 24]);
    expect(v.driftPct).not.toBe(0);
    expect(v.alert).toBe(false);
    expect(v.status).toBe('low_sample');
  });
});

describe('driftContext', () => {
  it('names the known cause and the pending fix while drift is elevated', () => {
    const c = driftContext(24);
    expect(c).toContain('look-back sync');
    expect(c).toContain('expected to stay high');
  });

  it('stops claiming a fix is pending once drift has actually fallen', () => {
    // Otherwise the panel would still say "expected to stay high" at 2% drift,
    // long after the look-back sync shipped — stale copy is quietly wrong copy.
    const c = driftContext(2);
    expect(c).not.toContain('expected to stay high');
    expect(c).toContain('checked daily');
  });

  it('keeps the known-issue wording when there is no reading yet', () => {
    expect(driftContext(null)).toContain('look-back sync');
  });
});
