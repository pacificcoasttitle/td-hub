'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Check, Clock } from 'lucide-react';
import { StatusDriftPanel, type StatusDrift } from './status-drift-panel';

interface WatchdogJob {
  jobType: string;
  label: string;
  kills: number;
  lastKill: string;
}

interface SummaryData {
  attention: string[];
  statusDrift: StatusDrift | null;
  watchdog: { last24h: number; byJob7d: WatchdogJob[] };
}

/**
 * Headline verdict plus the watchdog panel — the two things the page was
 * missing. Same shape as the daily email: the state in one line, and detail
 * only when there is something to say.
 */
export function OpsHeadline() {
  const [data, setData] = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch('/api/admin/ops/summary')
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (!cancelled) setData(d); })
        .catch(() => {})
        .finally(() => { if (!cancelled) setLoading(false); });
    };
    load();
    const iv = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, []);

  if (loading) {
    return <div className="h-16 bg-white border border-gray-200 rounded-lg animate-pulse mb-4" />;
  }
  if (!data) return null;

  const clean = data.attention.length === 0;
  const n = data.attention.length;

  return (
    <div className="mb-4 space-y-3">
      <div className={`rounded-lg border p-4 ${clean ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
        <div className="flex items-start gap-2.5">
          {clean
            ? <Check className="h-5 w-5 text-green-600 shrink-0 mt-0.5" />
            : <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />}
          <div className="min-w-0">
            <p className={`text-base font-semibold ${clean ? 'text-green-800' : 'text-amber-900'}`}>
              {clean
                ? 'All systems healthy'
                : `${n} thing${n === 1 ? '' : 's'} need${n === 1 ? 's' : ''} attention`}
            </p>
            {!clean && (
              <ul className="mt-1.5 space-y-1">
                {data.attention.map((item, i) => (
                  <li key={i} className="text-sm text-amber-900">• {item}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {data.statusDrift && <StatusDriftPanel drift={data.statusDrift} />}
      <WatchdogPanel watchdog={data.watchdog} />
    </div>
  );
}

/**
 * Jobs that hung and had to be stopped. Nothing on this page showed this
 * before, yet it is the clearest reliability signal the system produces —
 * a job that hangs, gets stopped, and silently retries looks fine in a
 * last-run column.
 */
function WatchdogPanel({ watchdog }: { watchdog: SummaryData['watchdog'] }) {
  const jobs = watchdog.byJob7d ?? [];
  if (jobs.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-gray-400" />
          <h2 className="text-sm font-semibold text-gray-900">Jobs that had to be stopped</h2>
        </div>
        <p className="text-sm text-gray-500 mt-1.5">
          None in the last 7 days — nothing hung.
        </p>
      </div>
    );
  }

  const total7d = jobs.reduce((s, j) => s + j.kills, 0);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-gray-400" />
          <h2 className="text-sm font-semibold text-gray-900">Jobs that had to be stopped</h2>
        </div>
        <span className="text-xs text-gray-500">
          {watchdog.last24h} in the last 24h · {total7d} in the last 7 days
        </span>
      </div>
      <p className="text-xs text-gray-500 mt-1">
        These runs stopped responding and were shut down automatically after 10 minutes.
        They normally retry on the next schedule.
      </p>
      <div className="mt-3 divide-y divide-gray-100">
        {jobs.map((j) => (
          <div key={j.jobType} className="flex items-center justify-between py-1.5 gap-3">
            <span className="text-sm text-gray-900">{j.label}</span>
            <span className="text-xs text-gray-500 shrink-0">
              {j.kills} time{j.kills === 1 ? '' : 's'} · last {j.lastKill}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
