'use client';

import { useCallback, useEffect, useState } from 'react';

interface VendorHealth {
  vendor: string;
  displayName: string;
  last24h: { total: number; success: number; failed: number; avgMs: number };
  lastSuccess: string | null;
  lastFailure: string | null;
  lastError: string | null;
  status: string;
}

const STATUS_DOT: Record<string, string> = {
  healthy: 'bg-green-500',
  degraded: 'bg-yellow-500',
  critical: 'bg-red-500',
  inactive: 'bg-gray-400',
};

const STATUS_TEXT: Record<string, string> = {
  healthy: 'text-green-700',
  degraded: 'text-yellow-700',
  critical: 'text-red-700',
  inactive: 'text-gray-500',
};

const VENDOR_LABELS: Record<string, string> = {
  softpro: 'SoftPro', s3: 'AWS S3', managers_report: 'Mgrs Report',
  titlepoint: 'TitlePoint', westcor: 'Westcor', fnf: 'FNF',
  sendgrid: 'SendGrid', twilio: 'Twilio', anthropic: 'Anthropic',
  title_production: 'Title Prod', sitex: 'SiteX', softpro_webhook: 'SP Webhooks',
};

function relTime(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

export function IntegrationHealth() {
  const [vendors, setVendors] = useState<VendorHealth[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    fetch('/api/admin/ops/health')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.vendors) setVendors(d.vendors); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const iv = setInterval(load, 60_000);
    return () => clearInterval(iv);
  }, [load]);

  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="bg-white border border-gray-200 rounded-lg p-3 animate-pulse">
            <div className="h-4 bg-gray-200 rounded w-2/3 mb-2" />
            <div className="h-3 bg-gray-100 rounded w-1/2 mb-1" />
            <div className="h-3 bg-gray-100 rounded w-1/3" />
          </div>
        ))}
      </div>
    );
  }

  if (vendors.length === 0) {
    return <p className="text-sm text-gray-500">No vendor activity in the last 24 hours.</p>;
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
      {vendors.map(v => {
        const isCritical = v.status === 'critical';
        const pct = v.last24h.total > 0 ? ((v.last24h.success / v.last24h.total) * 100).toFixed(1) : '0';
        const lastCall = v.lastSuccess ?? v.lastFailure;
        return (
          <div key={v.vendor}
            className={`rounded-lg p-3 ${isCritical ? 'bg-red-50 border border-red-300' : 'bg-white border border-gray-200'}`}>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${STATUS_DOT[v.status] ?? 'bg-gray-400'}`} />
                <span className="font-semibold text-sm text-gray-900">
                  {VENDOR_LABELS[v.vendor] ?? v.displayName}
                </span>
              </div>
              <span className={`text-xs font-medium ${STATUS_TEXT[v.status] ?? 'text-gray-500'}`}>
                {v.status}
              </span>
            </div>
            <p className="text-xs text-gray-500">{v.last24h.total} calls · {pct}%</p>
            <p className="text-xs text-gray-400" title={lastCall ?? undefined}>
              Last: {relTime(lastCall)}
            </p>
          </div>
        );
      })}
    </div>
  );
}
