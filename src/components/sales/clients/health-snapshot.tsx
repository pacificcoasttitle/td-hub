'use client';

import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import type { CrmClientMetrics } from './types';

// Read-only view over the metrics engine. Renders nothing it was not given —
// where the engine says "not enough history" or returns null, this says so
// rather than showing a zero or a made-up direction.

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function relativeDays(days: number | null): string {
  if (days === null) return '';
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30.44);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = (days / 365).toFixed(1).replace(/\.0$/, '');
  return `${years} year${years === '1' ? '' : 's'} ago`;
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <p className="text-lg font-semibold text-gray-900 leading-tight tabular-nums">{value}</p>
      <p className="text-[11px] text-gray-500 leading-tight mt-0.5">{label}</p>
      {hint && <p className="text-[11px] text-gray-400 leading-tight">{hint}</p>}
    </div>
  );
}

function TrendPill({ trend }: { trend: CrmClientMetrics['trend'] }) {
  if (trend.direction === 'not_enough_history') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-medium text-gray-500">
        Not enough history
      </span>
    );
  }

  // Deliberately no percentage on "holding steady": flat means the change is
  // inside the noise band, so "Holding steady -25%" would argue with itself.
  // The basis line under the grid still gives the raw counts.
  const pct = trend.direction === 'flat' || trend.changePct === null
    ? null
    : `${trend.changePct > 0 ? '+' : ''}${Math.round(trend.changePct * 100)}%`;

  const style = trend.direction === 'up'
    ? { cls: 'bg-emerald-50 text-emerald-700', Icon: TrendingUp, word: 'Trending up' }
    : trend.direction === 'down'
      ? { cls: 'bg-red-50 text-red-700', Icon: TrendingDown, word: 'Trending down' }
      : { cls: 'bg-gray-100 text-gray-600', Icon: Minus, word: 'Holding steady' };

  const { cls, Icon, word } = style;

  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium ${cls}`}>
      <Icon className="h-3 w-3" />
      {word}{pct && ` ${pct}`}
    </span>
  );
}

export function HealthSnapshot({ metrics }: { metrics: CrmClientMetrics }) {
  const { counts, recency, rate, trend } = metrics;

  // No contact link — there is no order history to compute from, and saying so
  // is more honest than a row of zeros.
  if (metrics.unlinked) {
    return (
      <div className="px-5 py-4 border-b border-gray-100 bg-gray-50/60">
        <h3 className="text-sm font-semibold text-gray-900 mb-1.5">Health snapshot</h3>
        <p className="text-xs text-gray-500">
          Not linked to a transaction contact yet, so there&rsquo;s no order history to read.
        </p>
      </div>
    );
  }

  if (counts.total === 0) {
    return (
      <div className="px-5 py-4 border-b border-gray-100 bg-gray-50/60">
        <h3 className="text-sm font-semibold text-gray-900 mb-1.5">Health snapshot</h3>
        <p className="text-xs text-gray-500">No orders with this client yet.</p>
      </div>
    );
  }

  const avg = rate.avgMonthlyOrders;

  return (
    <div className="px-5 py-4 border-b border-gray-100 bg-gray-50/60">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="text-sm font-semibold text-gray-900">Health snapshot</h3>
        <TrendPill trend={trend} />
      </div>

      <div className="grid grid-cols-3 gap-x-3 gap-y-3">
        <Stat label="orders this month" value={String(counts.thisMonth)} />
        <Stat label="last 90 days" value={String(counts.last90)} />
        {/* Not "open right now" — `in_process` is a catch-all files never leave,
            so this is only trustworthy as "hasn't reached a terminal status". */}
        <Stat label="files not yet closed" value={String(counts.open)} />

        <Stat
          label="same 90 days last year"
          value={String(counts.same90LastYear)}
        />
        <Stat
          label="avg per month"
          value={avg === null ? '—' : avg.toFixed(1)}
          hint={avg === null ? 'under a month of history' : undefined}
        />
        <Stat
          label="last order"
          value={relativeDays(recency.daysSinceLastOrder) || '—'}
          hint={fmtDate(recency.lastOrderAt)}
        />
      </div>

      {/* The rule, stated plainly, so the pill above is never a black box. */}
      <p className="mt-3 text-[11px] text-gray-400 leading-snug">{trend.basis}.</p>
    </div>
  );
}
