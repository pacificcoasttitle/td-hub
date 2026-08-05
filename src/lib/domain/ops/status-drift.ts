// Order-status drift: how far our stored operational_status has fallen behind
// SoftPro's actual status.
//
// WHY THIS EXISTS: `softpro.verify_sync` ran daily and reported success while
// examining 2 of 6,612 orders, because it filtered on `status = 'open'` — a
// status only 2 rows have ever held. A job that verifies nothing is a coverage
// gap wearing a green check, and it is why ~24% status drift accumulated
// unnoticed. See docs/order-status-hygiene.md.
//
// ALERTING IS BASELINE-RELATIVE, AND THAT IS DELIBERATE.
// Drift is ~24% today and stays there until the look-back sync ships. Alerting
// on the absolute rate would paint the panel red for weeks, and a permanently
// red panel gets ignored — the same "trains you to skip it" failure that got the
// never-called tiles dropped from /jobs. So:
//
//   - the absolute rate is ALWAYS displayed. The bad number is never hidden.
//   - the ALARM fires on deterioration against a trailing baseline.
//
// What is explicitly NOT allowed is raising a threshold until the current
// known-bad state reads healthy. That is the exact mistake verify_sync already
// made. The number stays visible; only the alarm logic is relative.
//
// This is self-maintaining: once the look-back sync drops drift to ~2%, the
// trailing baseline follows it down, and any later climb alarms again.

/** Counts from one detector run. */
export interface DriftCounts {
  /** Orders we got a definitive answer for from SoftPro. The drift denominator. */
  checked: number;
  /** Of `checked`, how many SoftPro now reports as closed/completed/cancelled. */
  drifted: number;
  /** Attempted but the call failed or timed out. Never enters the denominator. */
  unchecked: number;
  /** Never attempted — the run hit its time budget first. Not a failure. */
  notSampled: number;
}

export type DriftStatus =
  /** Fewer than two prior runs — showing the number, not judging it yet. */
  | 'no_baseline'
  /** Too few orders actually checked to say anything. */
  | 'low_sample'
  /** At or below the trailing baseline. Known-bad is still "steady". */
  | 'steady'
  /** Meaningfully worse than the trailing baseline. This is the alarm. */
  | 'deteriorating';

/**
 * Minimum orders checked before drift is allowed to raise an alarm. Same floor
 * as vendor health (MIN_SAMPLE_FOR_ALERT) so the page cannot contradict itself.
 */
export const MIN_CHECKED_FOR_ALERT = 20;

/**
 * How many percentage points above the trailing baseline counts as
 * deterioration rather than sampling noise.
 */
export const DETERIORATION_POINTS = 8;

/**
 * Readings smoothed together to form the "current" signal.
 *
 * A single run is noisy: at ~40 orders checked, the standard error on a ~20%
 * rate is about 6 points, so an 8-point threshold on one reading would be barely
 * over 1 SE and would false-alarm roughly one day in ten. Two real runs during
 * development measured 24% and 10.8% on the same population — the spread is the
 * noise, not a change.
 *
 * A false alarm is the expensive failure here. It trains people to ignore the
 * panel, which is the exact outcome this design exists to avoid, so the current
 * signal is the median of the last few readings rather than the latest one.
 * This costs a day or two of detection lag on a problem that moves over weeks.
 */
export const SMOOTHING_WINDOW = 3;

/** Prior runs considered when computing the trailing baseline. */
export const BASELINE_WINDOW = 7;

/** Readings required in the baseline window before it is trusted at all. */
export const MIN_RUNS_FOR_BASELINE = 2;

export function driftPct(counts: Pick<DriftCounts, 'checked' | 'drifted'>): number | null {
  if (counts.checked <= 0) return null;
  return (counts.drifted / counts.checked) * 100;
}

/** Median is used rather than mean so one bad run cannot drag the baseline up. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/**
 * Trailing baseline from older runs' drift rates.
 *
 * Skips the readings already folded into the smoothed current signal, so the
 * two are computed from disjoint sets — otherwise a rising run would drag the
 * baseline up with it and mask the very trend we are watching for.
 *
 * `priorPcts` must be ordered newest-first and exclude the current run.
 */
export function baselineFrom(priorPcts: number[]): number | null {
  const skip = SMOOTHING_WINDOW - 1;
  const window = priorPcts.slice(skip, skip + BASELINE_WINDOW);
  if (window.length < MIN_RUNS_FOR_BASELINE) return null;
  return median(window);
}

/**
 * The current signal: the median of the latest few readings, newest first.
 * Falls back to whatever is available when there is less history.
 */
export function smoothedCurrent(currentPct: number, priorPcts: number[]): number {
  return median([currentPct, ...priorPcts.slice(0, SMOOTHING_WINDOW - 1)])!;
}

export interface DriftVerdict {
  status: DriftStatus;
  /** The latest run's rate. Always what the panel displays. */
  driftPct: number | null;
  /** Median of recent runs — the value actually compared against the baseline. */
  smoothedPct: number | null;
  baselinePct: number | null;
  /** True only for `deteriorating`. Drives the needs-attention item. */
  alert: boolean;
  /** One plain-English line for the panel. */
  summary: string;
}

export function classifyDrift(counts: DriftCounts, priorPcts: number[]): DriftVerdict {
  const pct = driftPct(counts);
  const baseline = baselineFrom(priorPcts);
  const shown = pct === null ? '—' : `${pct.toFixed(0)}%`;

  if (pct === null || counts.checked < MIN_CHECKED_FOR_ALERT) {
    return {
      status: 'low_sample',
      driftPct: pct,
      smoothedPct: null,
      baselinePct: baseline,
      alert: false,
      summary: counts.checked === 0
        ? 'No orders could be checked against SoftPro on the last run.'
        : `Only ${counts.checked} orders checked — too few to judge (${shown} drifted).`,
    };
  }

  const smoothed = smoothedCurrent(pct, priorPcts);

  if (baseline === null) {
    return {
      status: 'no_baseline',
      driftPct: pct,
      smoothedPct: smoothed,
      baselinePct: null,
      alert: false,
      summary: `${shown} of ${counts.checked} in-flight orders have already closed in SoftPro. Establishing a baseline — no trend yet.`,
    };
  }

  // Epsilon guard: 28/100*100 is 28.000000000000004, so an exactly-at-margin
  // reading would otherwise trip the alarm on floating-point dust alone.
  if (smoothed - baseline > DETERIORATION_POINTS + 1e-9) {
    return {
      status: 'deteriorating',
      driftPct: pct,
      smoothedPct: smoothed,
      baselinePct: baseline,
      alert: true,
      summary: `Order status drift is getting worse: recent runs average ${smoothed.toFixed(0)}%, against a ${baseline.toFixed(0)}% baseline (latest run ${shown} of ${counts.checked} checked).`,
    };
  }

  return {
    status: 'steady',
    driftPct: pct,
    smoothedPct: smoothed,
    baselinePct: baseline,
    alert: false,
    summary: `${shown} of ${counts.checked} in-flight orders have already closed in SoftPro (baseline ${baseline.toFixed(0)}%).`,
  };
}

/**
 * Below this, drift is no longer "the known problem" and the standing
 * explanation would be stale. Set at the deterioration margin so the copy flips
 * at the same point the alarm stops caring.
 */
const ELEVATED_ABOVE_PCT = DETERIORATION_POINTS;

/**
 * The explanation shown under the number.
 *
 * Names the cause and the fix so a known-bad figure reads as "known, being
 * worked" rather than a mystery — without ever dressing it up as healthy. Once
 * drift actually falls, that copy would be stale and quietly wrong, so it flips
 * to the monitoring wording rather than claiming a fix is still pending forever.
 */
export function driftContext(pct: number | null): string {
  if (pct !== null && pct <= ELEVATED_ABOVE_PCT) {
    return 'Order status refresh is checked daily against SoftPro. The alert here '
      + 'fires when drift rises above its recent baseline.';
  }
  return 'Known issue: order status is only refreshed for orders opened the same day, '
    + 'so files that close later keep their old status. A look-back sync is the fix. '
    + 'This number is expected to stay high until that ships — the alert here fires '
    + 'on it getting worse, not on the known level.';
}
