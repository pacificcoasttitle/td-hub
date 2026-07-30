'use client';

import { useEffect, useState } from 'react';
import { formatCurrency } from '@/components/admin/dashboards/shared';
import type { BranchCode, SalesDashboardStats } from './types';
import { ProductionCountsBox } from './production-counts-box';
import { DeltaChip } from './delta-chip';
import { MiniSparkline } from './mini-sparkline';
import { SevenDayStrip } from './seven-day-strip';
import {
  computeDeltas, sixMonthSeries, type TrendsLike,
} from '@/lib/domain/sales/header-metrics';
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
  /** Manager's selected rep, so the header's own fetches match the page scope. */
  repId?: number | null;
}

export function DashboardKpi({ loading, stats, onOpenClosings, role, repId = null }: Props) {
  // Trends back the delta chips and the six-month sparkline. Fetched here
  // rather than folded into the dashboard payload so a trends outage degrades
  // those two elements only, leaving the rest of the header intact.
  const [trends, setTrends] = useState<TrendsLike | null>(null);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (repId != null) params.set('repId', String(repId));
    fetch(`/api/sales/trends${params.toString() ? `?${params}` : ''}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled) setTrends(d ?? null); })
      .catch(() => { if (!cancelled) setTrends(null); });
    return () => { cancelled = true; };
  }, [repId]);

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

  const now = new Date();
  const deltas = computeDeltas(trends, projected?.revenue ?? null, now);
  const revenueSeries = sixMonthSeries(trends, 'revenue', now);

  // Zero-value categories don't get a column — they stay in the footer
  // breakdown. TSG is footer-only by decision (see the spec addendum).
  const splitColumns: Array<{ label: string; value: number; share: number | null }> = production
    ? ([
      { label: 'Title', value: production.title },
      { label: 'Escrow', value: production.escrow },
    ]
      .filter((c) => c.value > 0)
      .map((c) => ({
        ...c,
        share: production.total > 0 ? Math.round((c.value / production.total) * 100) : null,
      })))
    : [];

  return (
    <div className="mb-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <button
          type="button"
          onClick={onOpenClosings}
          className="bg-[#1B2A4A] rounded-xl px-6 py-[22px] cursor-pointer hover:bg-[#233358] transition-colors relative overflow-hidden text-left w-full"
        >
          <div className="flex items-start justify-between gap-3">
            <p className="text-[11px] font-semibold text-[#93A4C4] uppercase tracking-[1.2px]">
              PRODUCTION (MTD)
            </p>
            {(deltas.mom || deltas.yoy) && (
              <div className="flex gap-1.5 flex-wrap justify-end">
                <DeltaChip delta={deltas.mom} />
                <DeltaChip delta={deltas.yoy} />
              </div>
            )}
          </div>

          <p className="text-[40px] font-bold text-white leading-tight tracking-[-1px] mt-1.5">
            {formatCurrency(production ? production.total : 0)}
          </p>

          {!production && (
            <p className="text-[11px] text-white/50 mt-2">Production data unavailable</p>
          )}

          {/* Projection is the forward-looking element (no goal exists to pace against). */}
          {hasMrMtd && projected && (
            <p className="text-[13px] text-[#7DE2B0] font-semibold mt-2">
              On pace to finish ~{formatCurrency(projected.revenue)}
              {typeof projected.workingDaysLeft === 'number' && (
                <span className="text-[11px] font-normal text-[#8FA0BF]">
                  {' '}· {projected.workingDaysLeft} working {projected.workingDaysLeft === 1 ? 'day' : 'days'} left
                </span>
              )}
            </p>
          )}

          {production && (splitColumns.length > 0 || revenueSeries) && (
            <div className="mt-4 pt-3.5 border-t border-white/10 flex items-center gap-6 flex-wrap">
              {splitColumns.map((col) => (
                <div key={col.label}>
                  <p className="text-[11px] text-[#8FA0BF] mb-0.5">{col.label}</p>
                  <p className="text-[19px] font-bold text-white leading-none">
                    {formatCurrency(col.value)}
                    {col.share !== null && (
                      <span className="text-[11px] font-medium text-[#8FA0BF]"> {col.share}%</span>
                    )}
                  </p>
                </div>
              ))}
              {revenueSeries && (
                <div className="ml-auto text-right">
                  <p className="text-[10px] text-[#7B8CAB] tracking-[0.4px]">6-MO TREND</p>
                  <div className="mt-0.5 flex justify-end">
                    <MiniSparkline
                      values={revenueSeries}
                      color="#FF8C4A"
                      ariaLabel={`Production revenue trend over the last ${revenueSeries.length} months`}
                    />
                  </div>
                </div>
              )}
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

        <ProductionCountsBox
          openings={openings}
          closings={closings}
          closingRatio={stats.closingRatio}
          openingsSeries={sixMonthSeries(trends, 'openings', now)}
          closingsSeries={sixMonthSeries(trends, 'closings', now)}
        />
      </div>

      {showBranchSplit && (
        <ProductionByBranchSection
          productionByBranch={stats.productionByBranch}
          homeBranchCode={stats.homeBranchCode}
          mtdRevenue={mtd?.revenue ?? null}
          yesterday={yesterday}
        />
      )}

      {/* Reps get the seven-day strip; managers keep Production by Branch above. */}
      {!showBranchSplit && (
        <SevenDayStrip repId={repId} yesterday={yesterday} />
      )}
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
