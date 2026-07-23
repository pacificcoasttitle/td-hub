'use client';

import { formatCurrency } from '@/components/admin/dashboards/shared';
import type { BranchCode, SalesDashboardStats } from './types';
import { ProductionCountsBox } from './production-counts-box';
import {
  BRANCH_CODE_LABELS,
  orderedLocationCodes,
} from '@/lib/integrations/managers-report/branch-codes';

interface Props {
  loading: boolean;
  stats: SalesDashboardStats | null;
  onOpenClosings: () => void;
  /**
   * v1: Production by Branch (MTD) renders for sales_manager only.
   * Reps do not get this framing (no assigned-territory data; ask came from managers).
   */
  role?: 'sales_rep' | 'sales_manager';
}

export function DashboardKpi({ loading, stats, onOpenClosings, role }: Props) {
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
  const showBranchSplit = role === 'sales_manager';

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
            <div className="mt-3 flex gap-6 flex-wrap">
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

          <div className="mt-3 pt-3 border-t border-white/10 flex items-center justify-between gap-3 flex-wrap">
            <p className="text-sm text-white/50">
              {production && (
                <>
                  <span>Breakdown: Purchase </span>
                  <span className="text-sm font-semibold text-[#F26B2B]">{formatCurrency(production.byDealType.purchase)}</span>
                  <span> · Refi </span>
                  <span className="text-sm font-semibold text-[#F26B2B]">{formatCurrency(production.byDealType.refinance)}</span>
                  {production.byDealType.other > 0 && (
                    <>
                      <span> · Other </span>
                      <span className="text-sm font-semibold text-[#F26B2B]">{formatCurrency(production.byDealType.other)}</span>
                    </>
                  )}
                  {hasMrMtd && projected && <span> · </span>}
                </>
              )}
              {hasMrMtd && projected && (
                <>
                  <span>Projected: </span>
                  <span className="text-sm font-semibold text-[#F26B2B]">{formatCurrency(projected.revenue)}</span>
                </>
              )}
            </p>
            <span className="text-sm text-white/50 hover:text-white/80 transition-colors shrink-0">
              View closed files →
            </span>
          </div>
        </button>

        <ProductionCountsBox openings={openings} closings={closings} />
      </div>

      {showBranchSplit && (
        <ProductionByBranchSection
          productionByBranch={stats.productionByBranch}
          homeBranchCode={stats.homeBranchCode}
          mtdRevenue={mtd?.revenue ?? null}
          yesterday={yesterday}
        />
      )}

      {!showBranchSplit && (
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-[11px] text-gray-500 uppercase tracking-wide">YESTERDAY</p>
          <YesterdayLine yesterday={yesterday} />
        </div>
      )}
    </div>
  );
}

function YesterdayLine({
  yesterday,
}: {
  yesterday: { closed: number; revenue: number; opens: number } | null;
}) {
  if (!yesterday) {
    return (
      <div className="flex items-baseline gap-2 mt-1">
        <span className="text-[28px] font-semibold text-gray-400">—</span>
        <span className="text-xs text-gray-500">No data</span>
      </div>
    );
  }
  return (
    <div className="flex items-baseline gap-2 mt-1 flex-wrap">
      <span className="text-[28px] font-semibold text-gray-900 tabular-nums">
        {yesterday.closed.toLocaleString()}
      </span>
      <span className="text-xs text-gray-500">
        closed · {formatCurrency(yesterday.revenue)}
        {yesterday.opens > 0 && (
          <> · {yesterday.opens.toLocaleString()} opened</>
        )}
      </span>
    </div>
  );
}

function ProductionByBranchSection({
  productionByBranch,
  homeBranchCode,
  mtdRevenue,
  yesterday,
}: {
  productionByBranch: SalesDashboardStats['productionByBranch'];
  homeBranchCode: BranchCode | null;
  mtdRevenue: number | null;
  yesterday: SalesDashboardStats['yesterday'];
}) {
  const unavailable =
    productionByBranch == null
    || productionByBranch.available === false;

  return (
    <div className={`bg-white border border-gray-200 rounded-xl p-4 ${unavailable ? 'opacity-70' : ''}`}>
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <p className="text-[11px] text-gray-500 uppercase tracking-wide">
          Production by Branch (MTD)
        </p>
        {mtdRevenue != null && !unavailable && (
          <p className="text-xs text-gray-500 tabular-nums">
            Total {formatCurrency(mtdRevenue)}
          </p>
        )}
      </div>

      {unavailable ? (
        <p className="mt-2 text-sm text-gray-500">
          Branch split unavailable
          {productionByBranch && !productionByBranch.available && productionByBranch.reason
            ? ` — ${productionByBranch.reason}`
            : ''}
          . Other dashboard figures are unaffected.
        </p>
      ) : (
        <BranchSplitRows
          data={productionByBranch}
          homeBranchCode={homeBranchCode}
        />
      )}

      {/* Yesterday kept as a clearly separated one-day sub-line — not mixed into MTD. */}
      <div className="mt-3 pt-3 border-t border-gray-100">
        <p className="text-[10px] text-gray-400 uppercase tracking-wide">Yesterday (1 day)</p>
        {yesterday ? (
          <p className="text-xs text-gray-600 mt-0.5 tabular-nums">
            {yesterday.closed.toLocaleString()} closed · {formatCurrency(yesterday.revenue)}
            {yesterday.opens > 0 ? ` · ${yesterday.opens.toLocaleString()} opened` : ''}
          </p>
        ) : (
          <p className="text-xs text-gray-400 mt-0.5">No yesterday data</p>
        )}
      </div>
    </div>
  );
}

function BranchSplitRows({
  data,
  homeBranchCode,
}: {
  data: Extract<NonNullable<SalesDashboardStats['productionByBranch']>, { available: true }>;
  homeBranchCode: BranchCode | null;
}) {
  const codes = orderedLocationCodes(homeBranchCode);
  // Hide zero-value locations for readability; zeros don't affect the total tie.
  const locationRows = codes
    .map((code) => ({
      code,
      label: BRANCH_CODE_LABELS[code],
      ...data.locations[code],
      isHome: homeBranchCode === code,
    }))
    .filter((row) => row.revenue !== 0 || row.closed !== 0 || row.isHome);

  // If everything is zero, still show a single neutral empty state with total context.
  const showLocations = locationRows.length > 0
    ? locationRows
    : codes.map((code) => ({
        code,
        label: BRANCH_CODE_LABELS[code],
        ...data.locations[code],
        isHome: homeBranchCode === code,
      }));

  return (
    <div className="mt-2 space-y-1.5">
      {showLocations.map((row) => (
        <BranchRow
          key={row.code}
          label={row.isHome ? `${row.label} (home)` : row.label}
          closed={row.closed}
          revenue={row.revenue}
        />
      ))}
      <BranchRow
        label="TSG (division)"
        closed={data.tsg.closed}
        revenue={data.tsg.revenue}
      />
      {(data.unassigned.revenue !== 0 || data.unassigned.closed !== 0) && (
        <BranchRow
          label="Unassigned"
          closed={data.unassigned.closed}
          revenue={data.unassigned.revenue}
        />
      )}
    </div>
  );
}

/** Neutral row — no red/amber/anomaly styling on non-home branches. */
function BranchRow({
  label,
  closed,
  revenue,
}: {
  label: string;
  closed: number;
  revenue: number;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-gray-700 truncate">{label}</span>
      <span className="text-gray-900 tabular-nums shrink-0">
        {formatCurrency(revenue)}
        <span className="text-gray-400 text-xs ml-1.5">
          · {closed.toLocaleString()} closed
        </span>
      </span>
    </div>
  );
}
