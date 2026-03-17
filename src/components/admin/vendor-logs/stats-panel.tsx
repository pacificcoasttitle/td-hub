'use client';

export interface LogStats {
  totalToday: number;
  successCount: number;
  errorCount: number;
  avgResponseMs: number;
  byVendor: Record<string, { count: number; successPct: number }>;
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

export function VendorCards({ stats, subTab }: { stats: LogStats | null; subTab: 'api' | 'documents' }) {
  if (subTab !== 'api') return null;
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {VENDORS.map((v) => {
        const key = v.toLowerCase();
        const data = stats?.byVendor?.[key];
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
