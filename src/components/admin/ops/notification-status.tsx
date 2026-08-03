'use client';

import { useCallback, useEffect, useState } from 'react';

interface NotifData {
  outbox: { total: number; processed: number; pending: number };
  deliveries: {
    total: number; sent: number; failed: number; skipped: number;
    recentLogs: DeliveryLog[];
  };
  emailsSent: number;
  smsSent: number;
}

interface DeliveryLog {
  id: number; eventType: string; channel: string;
  recipientEmail: string | null; status: string;
  createdAt: string | null;
}

const STATUS_CLS: Record<string, string> = {
  sent: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  skipped: 'bg-gray-100 text-gray-600',
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

export function NotificationStatus({ month, year }: { month: number; year: number }) {
  const [data, setData] = useState<NotifData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/admin/ops/notifications?month=${month}&year=${year}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setData(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [month, year]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const iv = setInterval(load, 60_000); return () => clearInterval(iv); }, [load]);

  return (
    <section>
      <h2 className="text-lg font-semibold text-gray-900 mb-3">Order notifications</h2>

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-gray-50 rounded-lg p-4 animate-pulse">
              <div className="h-3 bg-gray-200 rounded w-1/2 mb-2" />
              <div className="h-7 bg-gray-200 rounded w-1/3" />
            </div>
          ))}
        </div>
      ) : data ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <Stat label="Outbox total" value={data.outbox.total} />
            <Stat label="Processed" value={data.outbox.processed} color="text-green-700" />
            <Stat label="Pending" value={data.outbox.pending}
              color={data.outbox.pending > 0 ? 'text-amber-600' : undefined} />
            <Stat label="Emails sent" value={data.emailsSent} />
          </div>

          {data.deliveries.recentLogs.length > 0 ? (
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50/60">
                      <th className="text-left px-4 py-2.5 font-medium text-gray-500">Time</th>
                      <th className="text-left px-4 py-2.5 font-medium text-gray-500">Type</th>
                      <th className="text-left px-4 py-2.5 font-medium text-gray-500">Channel</th>
                      <th className="text-left px-4 py-2.5 font-medium text-gray-500">Recipient</th>
                      <th className="text-left px-4 py-2.5 font-medium text-gray-500">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.deliveries.recentLogs.map(l => (
                      <tr key={l.id}>
                        <td className="px-4 py-2.5 text-gray-500 text-xs" title={l.createdAt ?? undefined}>
                          {relTime(l.createdAt)}
                        </td>
                        <td className="px-4 py-2.5 text-gray-900 text-xs">
                          {l.eventType?.replace(/_/g, ' ') ?? '—'}
                        </td>
                        <td className="px-4 py-2.5 text-gray-700 text-xs capitalize">{l.channel}</td>
                        <td className="px-4 py-2.5 text-gray-500 text-xs truncate max-w-[180px]">
                          {l.recipientEmail ?? '—'}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_CLS[l.status] ?? 'bg-gray-100 text-gray-600'}`}>
                            {l.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-400">No notification deliveries this month.</p>
          )}
        </>
      ) : (
        <p className="text-sm text-gray-500">Failed to load notification data.</p>
      )}
    </section>
  );
}
