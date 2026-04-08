'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

interface TessaData {
  stats: {
    total: number; complete: number; failed: number; pending: number;
    documentsWithoutAnalysis: number;
    lastSuccessAt: string | null; lastFailureAt: string | null;
  };
  recentAnalyses: Analysis[];
}

interface Analysis {
  id: number; orderId: number; fileNumber: string;
  status: string; errorMessage: string | null;
  triggeredBy: string; createdAt: string | null;
  processingTimeMs: number | null;
}

const BADGE: Record<string, string> = {
  complete: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
};

function relTime(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

function Stat({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <div className="bg-gray-50 rounded-lg p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">{label}</p>
      <p className={`text-2xl font-bold tabular-nums mt-1 ${color ?? 'text-gray-900'}`}>{value}</p>
    </div>
  );
}

export function TessaStatus() {
  const [data, setData] = useState<TessaData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const load = useCallback(() => {
    fetch('/api/admin/ops/tessa')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setData(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const iv = setInterval(load, 60_000); return () => clearInterval(iv); }, [load]);

  const s = data?.stats;
  const analyses = data?.recentAnalyses?.slice(0, 10) ?? [];
  const allFailed = s && s.total > 0 && s.complete === 0 && s.failed > 0;

  return (
    <section>
      <h2 className="text-lg font-semibold text-gray-900 mb-3">TESSA prelim analysis</h2>

      {allFailed && (
        <div className="bg-red-50 border border-red-200 text-red-800 text-sm p-3 rounded mb-3">
          TESSA pipeline is not producing successful analyses. Check the health endpoint for diagnostics.
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-gray-50 rounded-lg p-4 animate-pulse">
              <div className="h-3 bg-gray-200 rounded w-1/2 mb-2" />
              <div className="h-7 bg-gray-200 rounded w-1/3" />
            </div>
          ))}
        </div>
      ) : s ? (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_2fr] gap-4">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Total" value={s.total} />
            <Stat label="Successful" value={s.complete} color="text-green-700" />
            <Stat label="Failed" value={s.failed} color={s.failed > 0 ? 'text-red-600' : undefined} />
            <Stat label="Pending prelims" value={s.documentsWithoutAnalysis}
              color={s.documentsWithoutAnalysis > 0 ? 'text-amber-600' : undefined} />
          </div>

          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50/60">
                    <th className="text-left px-3 py-2 font-medium text-gray-500">Order</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-500">File #</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-500">Status</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-500">Error</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-500">Triggered</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-500">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {analyses.length === 0 ? (
                    <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-500">No analyses yet.</td></tr>
                  ) : analyses.map(a => (
                    <tr key={a.id}>
                      <td className="px-3 py-2">
                        <Link href={`/orders/${a.orderId}`} className="text-blue-600 hover:underline text-xs">#{a.orderId}</Link>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-gray-900">{a.fileNumber}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium capitalize ${BADGE[a.status] ?? 'bg-gray-100 text-gray-600'}`}>
                          {a.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 max-w-[160px]">
                        {a.errorMessage ? (
                          <button onClick={() => setExpandedId(expandedId === a.id ? null : a.id)}
                            className="text-xs text-red-600 truncate block max-w-full text-left hover:underline"
                            title={a.errorMessage}>
                            {expandedId === a.id ? a.errorMessage : (a.errorMessage.length > 40 ? a.errorMessage.slice(0, 40) + '…' : a.errorMessage)}
                          </button>
                        ) : <span className="text-xs text-gray-400">—</span>}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-500" title={a.createdAt ?? undefined}>
                        {relTime(a.createdAt)}
                      </td>
                      <td className="px-3 py-2 text-right text-xs text-gray-500 tabular-nums">
                        {a.processingTimeMs != null ? `${(a.processingTimeMs / 1000).toFixed(1)}s` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <p className="text-sm text-gray-500">Failed to load TESSA data.</p>
      )}
    </section>
  );
}
