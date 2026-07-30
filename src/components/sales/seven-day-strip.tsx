'use client';

import { useEffect, useState } from 'react';
import { formatCurrency } from '@/components/admin/dashboards/shared';
import type { DayBucket } from '@/lib/domain/sales/header-metrics';

interface SeriesResponse {
  available: boolean;
  days?: DayBucket[];
  totalClosings?: number;
  totalRevenue?: number;
  bestDay?: DayBucket | null;
  monthDailyAvg?: number | null;
}

interface Props {
  repId: number | null;
  yesterday: { closed: number; revenue: number; opens: number } | null;
}

const BAR_BOX = 46;

function fmtYesterdayLabel(days: DayBucket[] | undefined): string {
  const latest = days?.find((d) => d.isLatest);
  if (!latest) return 'YESTERDAY';
  const [y, m, d] = latest.date.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return `YESTERDAY · ${dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase()}`;
}

/**
 * Rep-only. Managers keep the Production-by-Branch widget in this slot — see
 * dashboard-kpi.tsx. The left block keeps using the Managers Report `yesterday`
 * figure so it stays identical to what the rep saw before; the bars and rollup
 * come from the closings feed bucketed by day.
 */
export function SevenDayStrip({ repId, yesterday }: Props) {
  const [data, setData] = useState<SeriesResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams();
    if (repId != null) params.set('repId', String(repId));
    fetch(`/api/sales/daily-series${params.toString() ? `?${params}` : ''}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [repId]);

  const days = data?.available ? data.days ?? [] : [];
  const maxClosings = days.reduce((mx, d) => Math.max(mx, d.closings), 0);
  const avg = data?.monthDailyAvg ?? null;

  return (
    <div className="bg-white border border-gray-200 rounded-xl px-4 py-[22px]">
      <div className="flex items-start gap-0 flex-wrap">
        {/* Yesterday — unchanged source, plus the daily-average comparison */}
        <div className="min-w-[210px]">
          <p className="text-[11px] text-gray-500 uppercase tracking-[1.1px]">
            {fmtYesterdayLabel(days)}
          </p>
          {yesterday ? (
            <>
              <div className="flex items-baseline gap-2 mt-1 flex-wrap">
                <span className="text-[30px] font-bold text-[#1B2A4A] leading-none tabular-nums">
                  {yesterday.closed.toLocaleString()}
                </span>
                <span className="text-[13px] text-[#5B6577]">
                  closed · {formatCurrency(yesterday.revenue)}
                  {yesterday.opens > 0 && <> · {yesterday.opens.toLocaleString()} opened</>}
                </span>
              </div>
              {avg !== null && (
                <p className="text-[11px] text-[#8A94A6] mt-1">
                  vs {avg.toFixed(1)} avg/day this month
                </p>
              )}
            </>
          ) : (
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-[30px] font-bold text-gray-400 leading-none">—</span>
              <span className="text-[13px] text-[#8A94A6]">No data</span>
            </div>
          )}
        </div>

        {/* Seven-day bars — omitted entirely when the series is unavailable */}
        {loading ? (
          <div className="flex gap-1 mt-3 sm:mt-0 sm:pl-[26px] sm:ml-[26px] sm:border-l sm:border-[#EEF0F4]">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="w-[44px] h-[72px] bg-gray-100 rounded animate-pulse" />
            ))}
          </div>
        ) : days.length > 0 ? (
          <div
            className="flex mt-3 sm:mt-0 sm:pl-[26px] sm:ml-[26px] sm:border-l sm:border-[#EEF0F4]"
            role="img"
            aria-label={`Closings for the last 7 days: ${days.map((d) => `${d.dow} ${d.closings}`).join(', ')}`}
          >
            {days.map((d) => {
              const height = d.closings > 0
                ? Math.max(8, (d.closings / (maxClosings || 1)) * BAR_BOX)
                : 3;
              return (
                <div key={d.date} className="flex flex-col items-center gap-1.5 w-[44px]">
                  <span className={`text-[11px] font-bold tabular-nums ${d.isLatest ? 'text-[#F26B2B]' : 'text-[#3D4B66]'}`}>
                    {d.closings > 0 ? d.closings : '–'}
                  </span>
                  <span className="h-[46px] flex items-end" aria-hidden="true">
                    <span
                      className={`w-[22px] rounded ${d.isLatest ? 'bg-[#F26B2B]' : 'bg-[#C8D2E2]'}`}
                      style={{ height: `${height}px` }}
                    />
                  </span>
                  <span className={`text-[10px] ${d.isLatest ? 'text-[#1B2A4A] font-bold' : 'text-[#93A0B5] font-medium'}`}>
                    {d.isLatest ? 'Yest.' : d.dow}
                  </span>
                </div>
              );
            })}
          </div>
        ) : null}

        {/* Weekly rollup */}
        {days.length > 0 && (
          <div className="ml-auto text-right">
            <p className="text-[11px] text-gray-500 uppercase tracking-[1.1px]">Last 7 days</p>
            <p className="text-[18px] font-bold text-[#1B2A4A] mt-1 tabular-nums">
              {(data?.totalClosings ?? 0).toLocaleString()} closed
            </p>
            <p className="text-[11px] text-[#8A94A6]">
              {formatCurrency(data?.totalRevenue ?? 0)}
              {data?.bestDay && <> · best {data.bestDay.dow} ({data.bestDay.closings})</>}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
