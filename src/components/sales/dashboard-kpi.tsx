'use client';

import { formatCurrency } from '@/components/admin/dashboards/shared';
import type { SalesDashboardStats } from './types';
import { ProductionCountsBox } from './production-counts-box';

interface Props {
  loading: boolean;
  stats: SalesDashboardStats | null;
  onOpenClosings: () => void;
  /**
   * Retained for API compatibility with prior caller; unused — the dashboard
   * right box is now the counts box for ALL roles. The dedicated Ranking PAGE
   * remains manager-only (gated upstream in nav + route + API).
   */
  role?: 'sales_rep' | 'sales_manager';
}

export function DashboardKpi({ loading, stats, onOpenClosings }: Props) {
  if (loading) {
    return (
      <div className="mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div className="bg-[#1B2A4A]/80 rounded-xl p-6 h-[200px] animate-pulse" />
          <div className="bg-[#1B2A4A]/80 rounded-xl p-6 h-[200px] animate-pulse" />
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4 h-[100px] animate-pulse" />
      </div>
    );
  }

  if (!stats) return null;

  const mtd = stats.mtd;
  const hasMrMtd = mtd != null;
  const production = stats.production;
  const projected = stats.projected;
  const yesterday = stats.yesterday;
  const openings = stats.openings;
  const closings = stats.closings;

  return (
    <div className="mb-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <button
          type="button"
          onClick={onOpenClosings}
          className="bg-[#1B2A4A] rounded-xl p-6 cursor-pointer hover:bg-[#233358] transition-colors relative overflow-hidden text-left w-full"
        >
          <p className="text-xs text-white/60 uppercase tracking-wider">PRODUCTION (MTD)</p>
          <p className="text-[42px] font-semibold text-white leading-tight mt-1">
            {formatCurrency(production ? production.total : 0)}
          </p>

          {!production && (
            <p className="text-[11px] text-white/50 mt-2">Production data unavailable</p>
          )}

          {production && (
            <div className="flex gap-6 mt-3 flex-wrap">
              <div>
                <p className="text-xs text-white/50">Title</p>
                <p className="text-base text-white font-medium">{formatCurrency(production.title)}</p>
              </div>
              <div>
                <p className="text-xs text-white/50">Escrow</p>
                <p className="text-base text-white font-medium">{formatCurrency(production.escrow)}</p>
              </div>
              <div>
                <p className="text-xs text-white/50">TSG</p>
                <p className="text-base text-white font-medium">{formatCurrency(production.tsg)}</p>
              </div>
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

        <ProductionCountsBox openings={openings} closings={closings} />
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <p className="text-[11px] text-gray-500 uppercase tracking-wide">YESTERDAY</p>
        <div className="flex items-baseline gap-2 mt-1 flex-wrap">
          {yesterday ? (
            <>
              <span className="text-[28px] font-semibold text-gray-900 tabular-nums">
                {yesterday.closed.toLocaleString()}
              </span>
              <span className="text-xs text-gray-500">
                closed · {formatCurrency(yesterday.revenue)}
                {yesterday.opens > 0 && (
                  <> · {yesterday.opens.toLocaleString()} opened</>
                )}
              </span>
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
  );
}
