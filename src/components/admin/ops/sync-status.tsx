'use client';

import { useCallback, useEffect, useState } from 'react';

interface SyncData {
  orders: {
    total: number; withAddress: number; withSalesRep: number;
    withEscrow: number; missingEnrichment: number;
  };
  lastSyncAt: string | null;
  lastImportAt: string | null;
}

function relTime(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

function Stat({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="bg-gray-50 rounded-lg p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">{label}</p>
      <p className={`text-2xl font-bold tabular-nums mt-1 ${color ?? 'text-gray-900'}`}>{value}</p>
    </div>
  );
}

export function SyncStatus({ month, year }: { month: number; year: number }) {
  const [data, setData] = useState<SyncData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/admin/ops/sync?month=${month}&year=${year}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setData(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [month, year]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const iv = setInterval(load, 60_000); return () => clearInterval(iv); }, [load]);

  const o = data?.orders;
  const pct = o && o.total > 0 ? Math.round((o.withAddress / o.total) * 100) : 0;

  return (
    <section>
      <h2 className="text-lg font-semibold text-gray-900 mb-3">Orders received and filled in</h2>

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-gray-50 rounded-lg p-4 animate-pulse">
              <div className="h-3 bg-gray-200 rounded w-1/2 mb-2" />
              <div className="h-7 bg-gray-200 rounded w-1/3" />
            </div>
          ))}
        </div>
      ) : o ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <Stat label="Total orders" value={o.total} />
            <Stat label="With address" value={`${o.withAddress} / ${o.total}`} />
            <Stat label="With sales rep" value={`${o.withSalesRep} / ${o.total}`} />
            <Stat label="Missing address, rep or escrow officer" value={o.missingEnrichment}
              color={o.missingEnrichment > 0 ? 'text-red-600' : undefined} />
          </div>

          <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">Enrichment progress</span>
              <span className="text-sm font-semibold text-gray-900 tabular-nums">{pct}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2.5">
              <div className="bg-green-500 h-2.5 rounded-full transition-all" style={{ width: `${pct}%` }} />
            </div>
            <p className="text-xs text-gray-400 mt-1">{o.withAddress} of {o.total} orders enriched</p>
          </div>

          <div className="flex gap-6 text-sm text-gray-500">
            <span title={data.lastSyncAt ?? undefined}>
              Last sync: <strong className="text-gray-700">{relTime(data.lastSyncAt)}</strong>
            </span>
            <span title={data.lastImportAt ?? undefined}>
              Last import: <strong className="text-gray-700">{relTime(data.lastImportAt)}</strong>
            </span>
          </div>
        </>
      ) : (
        <p className="text-sm text-gray-500">Failed to load sync data.</p>
      )}
    </section>
  );
}
