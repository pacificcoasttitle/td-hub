'use client';

import { Activity } from 'lucide-react';

export interface StatusDrift {
  status: 'no_baseline' | 'low_sample' | 'steady' | 'deteriorating';
  /** The latest run's rate. Always displayed, including when it is bad. */
  driftPct: number | null;
  /** Median of recent runs — what the alarm actually compares. */
  smoothedPct: number | null;
  baselinePct: number | null;
  alert: boolean;
  summary: string;
  context: string;
  ranAt: string;
  counts: { checked: number; drifted: number; unchecked: number; notSampled: number };
  history: Array<{ ranAt: string; pct: number | null }>;
}

/**
 * Order status drift — how far our stored status has fallen behind SoftPro.
 *
 * The absolute number is ALWAYS shown, including when it is bad. What is
 * baseline-relative is only the alarm: drift sits around 24% until the look-back
 * sync ships, and a panel that is permanently red trains people to skip it,
 * which is the same failure that got the never-called tiles removed from this
 * page. So a known-bad-but-stable level reads as "known", a rise reads as an
 * alarm, and the figure itself is never dressed up.
 */
export function StatusDriftPanel({ drift }: { drift: StatusDrift }) {
  const pct = drift.driftPct;
  const worsening = drift.status === 'deteriorating';
  const weak = drift.status === 'low_sample';

  const tone = worsening
    ? 'border-amber-300 bg-amber-50'
    : 'border-gray-200 bg-white';

  return (
    <div className={`rounded-lg border p-4 ${tone}`}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Activity className={`h-4 w-4 ${worsening ? 'text-amber-600' : 'text-gray-400'}`} />
          <h2 className="text-sm font-semibold text-gray-900">Order status drift</h2>
        </div>
        <span className="text-xs text-gray-500">checked {drift.ranAt}</span>
      </div>

      <div className="mt-2.5 flex items-baseline gap-2 flex-wrap">
        <span className={`text-2xl font-semibold tabular-nums ${worsening ? 'text-amber-900' : 'text-gray-900'}`}>
          {pct === null ? '—' : `${pct.toFixed(0)}%`}
        </span>
        <span className="text-sm text-gray-600">
          of {drift.counts.checked} in-flight orders checked have already closed in SoftPro
        </span>
        {drift.baselinePct !== null && (
          <span className="text-xs text-gray-500">
            · baseline {drift.baselinePct.toFixed(0)}%
          </span>
        )}
      </div>

      {(drift.counts.unchecked > 0 || drift.counts.notSampled > 0) && (
        <p className="mt-1 text-xs text-gray-500">
          {drift.counts.unchecked > 0 && `${drift.counts.unchecked} could not be checked`}
          {drift.counts.unchecked > 0 && drift.counts.notSampled > 0 && ' · '}
          {drift.counts.notSampled > 0 && `${drift.counts.notSampled} not reached before the time limit`}
          {' — excluded from the percentage, not counted as clean.'}
        </p>
      )}

      {worsening && (
        <p className="mt-2 text-sm font-medium text-amber-900">{drift.summary}</p>
      )}
      {weak && (
        <p className="mt-2 text-sm text-gray-600">{drift.summary}</p>
      )}

      <p className="mt-2 text-xs text-gray-500 leading-snug">{drift.context}</p>

      {drift.history.length > 1 && (
        <div className="mt-2.5 flex items-end gap-1" aria-label="Recent drift readings">
          {[...drift.history].reverse().map((h, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1" title={`${h.ranAt}: ${h.pct === null ? '—' : `${h.pct.toFixed(0)}%`}`}>
              <div
                className={`w-full rounded-sm ${worsening && i === drift.history.length - 1 ? 'bg-amber-400' : 'bg-gray-300'}`}
                style={{ height: `${Math.max(2, Math.round((h.pct ?? 0) * 0.4))}px` }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
