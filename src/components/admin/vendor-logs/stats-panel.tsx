'use client';

interface VendorStat {
  vendor: string;
  total: number;
  successCount: number;
  errorCount: number;
  avgResponseMs: number;
}

export interface LogStats {
  vendors: VendorStat[];
  recentErrors: unknown[];
}

function agg(stats: LogStats | null) {
  if (!stats || stats.vendors.length === 0)
    return { totalToday: 0, successCount: 0, errorCount: 0, avgResponseMs: 0 };
  let totalToday = 0, successCount = 0, errorCount = 0, durSum = 0, durCount = 0;
  for (const v of stats.vendors) {
    totalToday += v.total;
    successCount += v.successCount;
    errorCount += v.errorCount;
    if (v.avgResponseMs > 0) { durSum += v.avgResponseMs * v.total; durCount += v.total; }
  }
  return { totalToday, successCount, errorCount, avgResponseMs: durCount > 0 ? Math.round(durSum / durCount) : 0 };
}

function vendorMap(stats: LogStats | null): Record<string, { count: number; successPct: number }> {
  const m: Record<string, { count: number; successPct: number }> = {};
  if (!stats) return m;
  for (const v of stats.vendors) {
    m[v.vendor.toLowerCase()] = {
      count: v.total,
      successPct: v.total > 0 ? (v.successCount / v.total) * 100 : 0,
    };
  }
  return m;
}

export const VENDORS = ['SoftPro', 'SiteX', 'TitlePoint', 'Westcor', 'FNF', 'SendGrid', 'Twilio'] as const;

export function StatCard({ label, value, loading, color }: { label: string; value?: number | string; loading: boolean; color?: string }) {
  return (
    <div className="flex-1 min-w-[100px] bg-white border border-gray-200 rounded-lg px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7280]">{label}</p>
      {loading ? (
        <div className="h-6 w-12 bg-gray-100 rounded mt-1 animate-pulse" />
      ) : (
        <p className={`text-xl font-bold tabular-nums mt-0.5 ${color ?? 'text-[#1A1A2E]'}`}>{value ?? '—'}</p>
      )}
    </div>
  );
}

export function StatsRow({ stats, loading, onRefresh }: { stats: LogStats | null; loading: boolean; onRefresh: () => void }) {
  const { totalToday, successCount, errorCount, avgResponseMs } = agg(stats);
  return (
    <div className="flex items-center gap-3">
      <StatCard label="Total Today" value={stats ? totalToday : undefined} loading={loading} />
      <StatCard label="Success" value={stats ? successCount : undefined} loading={loading} color="text-green-600" />
      <StatCard label="Errors" value={stats ? errorCount : undefined} loading={loading} color="text-red-600" />
      <StatCard label="Avg Response" value={stats ? `${avgResponseMs}ms` : undefined} loading={loading} />
      <button onClick={onRefresh} disabled={loading} title="Refresh stats"
        className="ml-auto p-2 text-[#6B7280] hover:text-[#1A1A2E] hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50">
        <svg className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
      </button>
    </div>
  );
}

export function VendorCards({ stats, subTab }: { stats: LogStats | null; subTab: 'api' | 'documents' }) {
  if (subTab !== 'api') return null;
  const byVendor = vendorMap(stats);
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {VENDORS.map((v) => {
        const data = byVendor[v.toLowerCase()];
        return (
          <div key={v} className="shrink-0 px-3 py-2 bg-white border border-gray-200 rounded-lg text-center min-w-[90px]">
            <p className="text-xs font-semibold text-[#1A1A2E]">{v}</p>
            <p className="text-lg font-bold text-[#1A1A2E] tabular-nums">{data?.count ?? 0}</p>
            {data && data.count > 0 && (
              <p className={`text-[10px] font-medium ${data.successPct >= 90 ? 'text-green-600' : data.successPct >= 70 ? 'text-amber-600' : 'text-red-600'}`}>
                {data.successPct.toFixed(0)}% ok
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
