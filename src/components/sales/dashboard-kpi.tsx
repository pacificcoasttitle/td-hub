'use client';

import { formatCurrency } from '@/components/admin/dashboards/shared';
import type { SalesDashboardStats } from './types';

interface Props {
  loading: boolean;
  stats: SalesDashboardStats | null;
  onOpenClosings: () => void;
}

function typedRevenueTotal(mtd: NonNullable<SalesDashboardStats['mtd']>): number {
  return (mtd.purchaseRevenue || 0) + (mtd.refinanceRevenue || 0);
}

function pctPart(part: number, total: number): number {
  if (total <= 0 || part <= 0) return 0;
  return Math.round((part / total) * 100);
}

function closeRatePercent(ratio: SalesDashboardStats['closingRatio']): number | null {
  if (!ratio || ratio.total <= 0) return null;
  return Math.round((ratio.closed / ratio.total) * 100);
}

export function DashboardKpi({ loading, stats, onOpenClosings }: Props) {
  if (loading) {
    return (
      <div className="mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div className="bg-[#1B2A4A]/80 rounded-xl p-6 h-[200px] animate-pulse" />
          <div className="bg-[#1B2A4A]/80 rounded-xl p-6 h-[200px] animate-pulse" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[0, 1, 2].map(i => (
            <div key={i} className="bg-white border border-gray-200 rounded-xl p-4 h-[100px] animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!stats) return null;

  const mtd = stats.mtd;
  const hasMrMtd = mtd != null;
  const ranking = stats.ranking;
  const projected = stats.projected;
  const ratePct = closeRatePercent(stats.closingRatio);
  const yesterday = stats.yesterday;

  const typedTotal = hasMrMtd ? typedRevenueTotal(mtd) : 0;

  return (
    <div className="mb-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <button
          type="button"
          onClick={onOpenClosings}
          className="bg-[#1B2A4A] rounded-xl p-6 cursor-pointer hover:bg-[#233358] transition-colors relative overflow-hidden text-left w-full"
        >
          <p className="text-xs text-white/60 uppercase tracking-wider">MTD REVENUE</p>
          <p className="text-[42px] font-semibold text-white leading-tight mt-1">
            {formatCurrency(hasMrMtd ? mtd.revenue : 0)}
          </p>

          {!hasMrMtd && (
            <p className="text-[11px] text-white/50 mt-2">Revenue data from local orders</p>
          )}

          {hasMrMtd && typedTotal > 0 && (
            <div className="flex gap-6 mt-3 flex-wrap">
              {(mtd.purchaseRevenue || 0) > 0 && (
                <div>
                  <p className="text-xs text-white/50">Purchase</p>
                  <p className="text-base text-white font-medium">
                    {formatCurrency(mtd.purchaseRevenue)} ({pctPart(mtd.purchaseRevenue || 0, typedTotal)}%)
                  </p>
                </div>
              )}
              {(mtd.refinanceRevenue || 0) > 0 && (
                <div>
                  <p className="text-xs text-white/50">Refinance</p>
                  <p className="text-base text-white font-medium">
                    {formatCurrency(mtd.refinanceRevenue)} ({pctPart(mtd.refinanceRevenue || 0, typedTotal)}%)
                  </p>
                </div>
              )}
            </div>
          )}

          <div
            className={`mt-3 pt-3 border-t border-white/10 flex items-center gap-2 ${
              hasMrMtd && projected ? 'justify-between' : 'justify-end'
            }`}
          >
            {hasMrMtd && projected && (
              <p className="text-sm text-white/50">
                Projected:{' '}
                <span className="text-sm font-semibold text-[#F26B2B]">{formatCurrency(projected.revenue)}</span>
              </p>
            )}
            <span className="text-sm text-white/50 hover:text-white/80 transition-colors shrink-0">
              View closed files →
            </span>
          </div>
        </button>

        <div className="bg-[#1B2A4A] rounded-xl p-6 flex flex-col items-center justify-center text-center">
          <p className="text-xs text-white/60 uppercase tracking-wider">YOUR RANKING</p>
          {ranking ? (
            <>
              <p className="text-[64px] font-semibold text-[#F26B2B] leading-none mt-1">#{ranking.position}</p>
              <p className="text-base text-white/50 mt-1">of {ranking.totalReps} reps</p>
            </>
          ) : (
            <>
              <p className="text-[64px] font-semibold text-white/30 leading-none mt-1">—</p>
              <p className="text-sm text-white/50 mt-1">Ranking unavailable</p>
            </>
          )}
          {ratePct !== null && (
            <div className="mt-3 pt-3 border-t border-white/10 w-full">
              <p className="text-sm text-white/50 text-center">
                <span className="text-sm font-semibold text-[#22C55E]">Close rate: {ratePct}%</span>
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-[11px] text-gray-500 uppercase tracking-wide">OPENINGS</p>
          <div className="flex items-baseline gap-2 mt-1 flex-wrap">
            <span className="text-[28px] font-semibold text-gray-900">{stats.openOrders.toLocaleString()}</span>
            <span className="text-xs text-gray-500">
              {hasMrMtd
                ? `${mtd.purchase.toLocaleString()} sale · ${mtd.refinance.toLocaleString()} refi`
                : '—'}
            </span>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-[11px] text-gray-500 uppercase tracking-wide">CLOSINGS</p>
          <div className="flex items-baseline gap-2 mt-1 flex-wrap">
            <span className="text-[28px] font-semibold text-gray-900">
              {stats.closedThisMonth.toLocaleString()}
            </span>
            <span className="text-xs text-gray-500">
              {hasMrMtd
                ? `${mtd.purchase.toLocaleString()} sale · ${mtd.refinance.toLocaleString()} refi`
                : '—'}
            </span>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-[11px] text-gray-500 uppercase tracking-wide">YESTERDAY</p>
          <div className="flex items-baseline gap-2 mt-1 flex-wrap">
            {yesterday ? (
              <>
                <span className="text-[28px] font-semibold text-gray-900">
                  {yesterday.closed.toLocaleString()}
                </span>
                <span className="text-xs text-gray-500">closed · {formatCurrency(yesterday.revenue)}</span>
              </>
            ) : (
              <>
                <span className="text-[28px] font-semibold text-gray-400">—</span>
                <span className="text-xs text-gray-500">No data</span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
