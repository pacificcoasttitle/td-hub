'use client';

import { useCallback, useEffect, useState } from 'react';

interface CronJob {
  jobType: string;
  schedule: string;
  lastRun: string | null;
  lastStatus: string | null;
  lastError: string | null;
  monthly: { runs: number; completed: number; failed: number };
  avgDurationMs: number;
}

interface EnrichmentCoverage {
  ok: boolean;
  data?: {
    zeroPartyTotal: number;
    zeroPartyUnconfirmed: number;
    emptyConfirmedTotal: number;
    fkOnlyStuck: number;
    ordersWithRealParticipant: number;
    currentBacklogSize: number;
    minutesSinceLastCompleted: number | null;
    alerts: string[];
  };
  error?: string;
}

const JOB_LABELS: Record<string, string> = {
  'softpro.sync_recent_orders': 'Sync Recent Orders',
  'softpro.enrich_orders': 'Enrich Orders',
  'softpro.fetch_prelims': 'Fetch Prelims',
  'notifications.process_outbox': 'Process Notifications',
  'softpro.verify_sync': 'Verify Sync',
  'softpro.sync_new_users': 'Sync New Users',
  'softpro.sync_all_contacts': 'Sync All Contacts',
  'import-orders': 'Import Orders',
  'ops.daily_report': 'Daily Ops Report',
};

const STATUS_CLS: Record<string, string> = {
  completed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  running: 'bg-blue-100 text-blue-800',
  queued: 'bg-gray-100 text-gray-700',
};

function relTime(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function CronStatus({ month, year }: { month: number; year: number }) {
  const [crons, setCrons] = useState<CronJob[]>([]);
  const [coverage, setCoverage] = useState<EnrichmentCoverage | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/admin/ops/crons?month=${month}&year=${year}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.crons) {
          const sorted = [...d.crons].sort((a: CronJob, b: CronJob) => {
            if (!a.lastRun) return 1;
            if (!b.lastRun) return -1;
            return new Date(b.lastRun).getTime() - new Date(a.lastRun).getTime();
          });
          setCrons(sorted);
        }
        if (d?.enrichmentCoverage) setCoverage(d.enrichmentCoverage);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [month, year]);

  useEffect(() => {
    const timeout = setTimeout(load, 0);
    return () => clearTimeout(timeout);
  }, [load]);
  useEffect(() => {
    const iv = setInterval(load, 60_000);
    return () => clearInterval(iv);
  }, [load]);

  return (
    <section>
      <h2 className="text-lg font-semibold text-gray-900 mb-3">Scheduled jobs</h2>
      {coverage?.ok && coverage.data && (
        <div className={`mb-4 rounded-lg border p-4 ${coverage.data.alerts.length > 0 ? 'bg-amber-50 border-amber-200' : 'bg-white border-gray-200'}`}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Enrichment Coverage</h3>
              <p className="text-xs text-gray-500 mt-1">
                Real residue: {coverage.data.zeroPartyUnconfirmed} zero-party unconfirmed · {coverage.data.emptyConfirmedTotal} empty-confirmed · {coverage.data.fkOnlyStuck} FK-only stuck
              </p>
            </div>
            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${coverage.data.alerts.length > 0 ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-800'}`}>
              {coverage.data.alerts.length > 0 ? 'Attention' : 'Healthy'}
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
            <CoverageStat label="Zero-party total" value={coverage.data.zeroPartyTotal} />
            <CoverageStat label="Current backlog" value={coverage.data.currentBacklogSize} />
            <CoverageStat label="Real participants" value={coverage.data.ordersWithRealParticipant} />
            <CoverageStat label="Last enrich run" value={coverage.data.minutesSinceLastCompleted === null ? 'Never' : `${coverage.data.minutesSinceLastCompleted}m ago`} />
          </div>
          {coverage.data.alerts.length > 0 && (
            <ul className="mt-3 list-disc pl-5 text-xs text-amber-800">
              {coverage.data.alerts.map((alert) => <li key={alert}>{alert}</li>)}
            </ul>
          )}
        </div>
      )}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50/60">
                <th className="text-left px-4 py-2.5 font-medium text-gray-500">Job</th>
                <th className="text-left px-4 py-2.5 font-medium text-gray-500">Schedule</th>
                <th className="text-left px-4 py-2.5 font-medium text-gray-500">Last Run</th>
                <th className="text-left px-4 py-2.5 font-medium text-gray-500">Status</th>
                <th className="text-right px-4 py-2.5 font-medium text-gray-500">Runs</th>
                <th className="text-right px-4 py-2.5 font-medium text-gray-500">Failures</th>
                <th className="text-right px-4 py-2.5 font-medium text-gray-500">Avg Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    {Array.from({ length: 7 }).map((__, j) => (
                      <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-200 rounded w-3/4" /></td>
                    ))}
                  </tr>
                ))
              ) : crons.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">No cron data for this month.</td></tr>
              ) : crons.map(c => (
                <tr key={c.jobType} className={c.monthly.failed > 0 ? 'bg-red-50' : ''}>
                  <td className="px-4 py-3 font-medium text-gray-900">{JOB_LABELS[c.jobType] ?? c.jobType}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{c.schedule}</td>
                  <td className="px-4 py-3 text-gray-500" title={c.lastRun ?? undefined}>{relTime(c.lastRun)}</td>
                  <td className="px-4 py-3">
                    {c.lastStatus && (
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_CLS[c.lastStatus] ?? 'bg-gray-100 text-gray-600'}`}>
                        {c.lastStatus}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-700">{c.monthly.runs}</td>
                  <td className={`px-4 py-3 text-right tabular-nums ${c.monthly.failed > 0 ? 'text-red-600 font-medium' : 'text-gray-700'}`}>
                    {c.monthly.failed}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-500">{fmtMs(c.avgDurationMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function CoverageStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md bg-gray-50 border border-gray-100 px-3 py-2">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-lg font-semibold text-gray-900 tabular-nums">{value}</p>
    </div>
  );
}
