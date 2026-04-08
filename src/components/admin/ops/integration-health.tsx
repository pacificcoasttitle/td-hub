'use client';

import { useCallback, useEffect, useState } from 'react';

interface VendorHealth {
  vendor: string;
  displayName: string;
  health: { status: string; lastSuccess: string | null; lastFailure: string | null };
  last24h: { total: number; success: number; failed: number; avgMs: number };
  monthly: { total: number; success: number; failed: number };
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

const ALL_VENDORS = [
  'softpro', 's3', 'managers_report', 'titlepoint', 'westcor',
  'fnf', 'sendgrid', 'twilio', 'anthropic', 'title_production',
  'sitex', 'softpro_webhook',
];

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

function fmtNum(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export function IntegrationHealth({ month, year }: { month: number; year: number }) {
  const [vendors, setVendors] = useState<VendorHealth[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/admin/ops/health?month=${month}&year=${year}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        const apiVendors: VendorHealth[] = d?.vendors ?? [];
        const apiMap = new Map(apiVendors.map(v => [v.vendor, v]));
        const merged = ALL_VENDORS.map(key => {
          const data = apiMap.get(key);
          return data ?? {
            vendor: key,
            displayName: VENDOR_LABELS[key] || key,
            health: { status: 'inactive', lastSuccess: null, lastFailure: null },
            last24h: { total: 0, success: 0, failed: 0, avgMs: 0 },
            monthly: { total: 0, success: 0, failed: 0 },
          };
        });
        setVendors(merged);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [month, year]);

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

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
      {vendors.map(v => {
        const status = v.health?.status ?? 'inactive';
        const isCritical = status === 'critical';
        const lastCall = v.health?.lastSuccess ?? v.health?.lastFailure ?? null;
        return (
          <div key={v.vendor}
            className={`rounded-lg p-3 ${isCritical ? 'bg-red-50 border border-red-300' : 'bg-white border border-gray-200'}`}>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${STATUS_DOT[status] ?? 'bg-gray-400'}`} />
                <span className="font-semibold text-sm text-gray-900">
                  {VENDOR_LABELS[v.vendor] ?? v.displayName}
                </span>
              </div>
              <span className={`text-xs font-medium ${STATUS_TEXT[status] ?? 'text-gray-500'}`}>
                {status}
              </span>
            </div>
            <p className="text-xs text-gray-500">
              {fmtNum(v.monthly.total)} calls · {v.monthly.failed > 0 ? `${v.monthly.failed} failed` : 'no failures'}
            </p>
            <p className="text-xs text-gray-400" title={lastCall ?? undefined}>
              Last: {relTime(lastCall)}
            </p>
          </div>
        );
      })}
    </div>
  );
}
