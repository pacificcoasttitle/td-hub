'use client';

import type { SalesDashboardStats } from './types';
import { LitCard } from '@/components/brand/lit-card';
import { MiniSparkline } from './mini-sparkline';

interface Props {
  openings: SalesDashboardStats['openings'];
  closings: SalesDashboardStats['closings'];
  /**
   * Managers Report's authoritative cohort figure. NOT closed ÷ opened — those
   * are different cohorts (see the spec addendum, §3).
   */
  closingRatio?: SalesDashboardStats['closingRatio'];
  /** Trailing six months, for the per-hero sparklines. Omitted when unavailable. */
  openingsSeries?: number[] | null;
  closingsSeries?: number[] | null;
}

type Line = { label: string; value: number };

/**
 * Build the lines for the OPENED hero.
 * MR provides byType.{purchase,refinance,escrow,tsg,other} that already reconciles
 * to total. Purchase/Refinance always; Escrow/TSG/Other each only when > 0.
 * Order: Purchase · Refinance · Escrow · TSG · Other.
 * "Other" is MR's true residual (byType.other) — never a locally computed catch-all.
 */
function openingsLines(o: NonNullable<SalesDashboardStats['openings']>): Line[] {
  const purchase = o.byType?.purchase ?? 0;
  const refinance = o.byType?.refinance ?? 0;
  const escrow = o.byType?.escrow ?? 0;
  const tsg = o.byType?.tsg ?? 0;
  const other = o.byType?.other ?? 0;
  const lines: Line[] = [
    { label: 'Purchase', value: purchase },
    { label: 'Refinance', value: refinance },
  ];
  if (escrow > 0) lines.push({ label: 'Escrow', value: escrow });
  if (tsg > 0) lines.push({ label: 'TSG', value: tsg });
  if (other > 0) lines.push({ label: 'Other', value: other });
  return lines;
}

/**
 * Build the lines for the CLOSED hero.
 * Purchase/Refinance always; Escrow/TSG each only when count > 0.
 * Order: Purchase · Refinance · Escrow · TSG.
 * The four named categories reconcile to closings.total, so the computed
 * remainder is normally 0. Retained as a > 0 guard: if a future stray category
 * appears, it surfaces as "Other" rather than silently breaking the sum.
 */
function closingsLines(c: NonNullable<SalesDashboardStats['closings']>): Line[] {
  const purchaseCount = c.byType?.purchase?.count ?? 0;
  const refinanceCount = c.byType?.refinance?.count ?? 0;
  const escrowCount = c.byType?.escrow?.count ?? 0;
  const tsgCount = c.byType?.tsg?.count ?? 0;
  const showEscrow = escrowCount > 0;
  const showTsg = tsgCount > 0;

  const lines: Line[] = [
    { label: 'Purchase', value: purchaseCount },
    { label: 'Refinance', value: refinanceCount },
  ];
  if (showEscrow) lines.push({ label: 'Escrow', value: escrowCount });
  if (showTsg) lines.push({ label: 'TSG', value: tsgCount });

  const shown = purchaseCount + refinanceCount
    + (showEscrow ? escrowCount : 0)
    + (showTsg ? tsgCount : 0);
  const other = Math.max(0, c.total - shown);
  if (other > 0) lines.push({ label: 'Other', value: other });

  return lines;
}

export function ProductionCountsBox({
  openings,
  closings,
  closingRatio = null,
  openingsSeries = null,
  closingsSeries = null,
}: Props) {
  const hasData = openings !== null || closings !== null;

  if (!hasData) {
    return (
      <LitCard className="min-h-[200px]">
        <div className="flex min-h-[156px] flex-col items-center justify-center text-center">
          <p className="font-serif text-[42px] font-semibold leading-none text-white/30">—</p>
          <p className="mt-1 text-sm text-white/50">Production data unavailable</p>
        </div>
      </LitCard>
    );
  }

  const openTotal = openings?.total ?? 0;
  const closedTotal = closings?.total ?? 0;
  const openLines = openings ? openingsLines(openings) : [];
  const closedLines = closings ? closingsLines(closings) : [];

  // Reconciliation invariant: every visible line set must sum to its hero.
  // Mismatches indicate an MR data bug — surface them instead of hiding.
  const openSum = openLines.reduce((s, l) => s + l.value, 0);
  const closedSum = closedLines.reduce((s, l) => s + l.value, 0);
  const openMismatch = openings !== null && openSum !== openTotal;
  const closedMismatch = closings !== null && closedSum !== closedTotal;

  // Projected line is gated on MR exposing the fields — omit entirely otherwise
  // (no fabricated/zero values).
  const projectedOpens = typeof openings?.projected === 'number' ? openings.projected : null;
  const projectedClosings = typeof closings?.projected === 'number' ? closings.projected : null;
  const showProjected = projectedOpens !== null || projectedClosings !== null;

  // Pull-through is MR's own closed/created cohort ratio; omitted when absent
  // rather than substituted with a hand-computed figure.
  const pullThrough = closingRatio && closingRatio.total > 0
    ? Math.round((closingRatio.closed / closingRatio.total) * 100)
    : null;

  return (
    <LitCard>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[9.5px] font-extrabold uppercase tracking-[1.6px] text-white/50">
          PIPELINE (MTD)
        </p>
        {pullThrough !== null && (
          <p
            className="shrink-0 text-[11px] text-white/45"
            title={`Managers Report closing ratio: ${closingRatio!.closed.toLocaleString()} closed of ${closingRatio!.total.toLocaleString()} created`}
          >
            Pull-through{' '}
            <span className="text-[13px] font-bold text-[#7FE3B5]">{pullThrough}%</span>
          </p>
        )}
      </div>

      <div className="mt-2 grid grid-cols-2 gap-[18px]">
        <Hero
          label="OPENED"
          total={openTotal}
          lines={openLines}
          hasData={openings !== null}
          series={openingsSeries}
        />
        <Hero
          label="CLOSED"
          total={closedTotal}
          lines={closedLines}
          hasData={closings !== null}
          series={closingsSeries}
          bordered
        />
      </div>

      {(showProjected || openMismatch || closedMismatch) && (
        <div className="mt-3 space-y-1 border-t border-white/10 pt-3">
          {showProjected && (
            <p className="text-[12.5px] leading-[1.7] text-white/[0.66]">
              {projectedOpens !== null && (
                <>
                  Proj. opened:{' '}
                  <span className="font-bold text-[#FFA76B]">
                    {projectedOpens.toLocaleString()}
                  </span>
                </>
              )}
              {projectedOpens !== null && projectedClosings !== null && (
                <span className="text-white/30"> · </span>
              )}
              {projectedClosings !== null && (
                <>
                  Proj. closed:{' '}
                  <span className="font-bold text-[#FFA76B]">
                    {projectedClosings.toLocaleString()}
                  </span>
                </>
              )}
            </p>
          )}
          {(openMismatch || closedMismatch) && (
            <p className="text-[11px] text-amber-300" role="status">
              {openMismatch && (
                <span>Openings by type ({openSum}) does not sum to total ({openTotal}). </span>
              )}
              {closedMismatch && (
                <span>Closings by type ({closedSum}) does not sum to total ({closedTotal}). </span>
              )}
            </p>
          )}
        </div>
      )}
    </LitCard>
  );
}

function Hero({
  label,
  total,
  lines,
  hasData,
  series = null,
  bordered = false,
}: {
  label: string;
  total: number;
  lines: Line[];
  hasData: boolean;
  series?: number[] | null;
  bordered?: boolean;
}) {
  return (
    <div className={bordered ? 'border-l border-white/10 pl-[18px]' : undefined}>
      {hasData ? (
        <>
          <div className="flex items-baseline gap-2">
            <span className="font-serif text-[38px] font-bold leading-none tracking-[-0.026em] text-[#F59E5B] tabular-nums">
              {total.toLocaleString()}
            </span>
            <span className="text-xs font-semibold uppercase tracking-[0.5px] text-white/60">
              {label}
            </span>
            {series && (
              /* Secondary context — dropped on narrow screens rather than
                 squeezing the count it sits beside. */
              <span className="ml-auto hidden shrink-0 sm:inline-block">
                <MiniSparkline
                  values={series}
                  color="rgba(255,255,255,0.5)"
                  width={66}
                  height={20}
                  ariaLabel={`${label.toLowerCase()} trend over the last ${series.length} months`}
                />
              </span>
            )}
          </div>
          {lines.length > 0 && (
            <div className="mt-3 rounded-[14px] border border-white/[0.16] bg-white/[0.09] px-[18px] py-[15px]">
              <div className="flex flex-wrap gap-5">
                {lines.map((line) => {
                  // Escrow is real data but an order of magnitude smaller —
                  // dimmed so it doesn't compete visually with purchase.
                  const dim = line.label === 'Escrow';
                  return (
                    <div key={line.label} className={dim ? 'opacity-50' : undefined}>
                      <p className="text-[10.5px] font-semibold tracking-[0.4px] text-white/45">
                        {line.label}
                      </p>
                      <p className={`tabular-nums text-white ${dim ? 'text-base font-semibold' : 'text-[21px] font-extrabold tracking-[-0.5px]'}`}>
                        {line.value.toLocaleString()}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="flex items-baseline gap-2">
            <span className="font-serif text-[38px] font-bold leading-none text-white/30">—</span>
            <span className="text-xs font-semibold uppercase tracking-[0.5px] text-white/60">{label}</span>
          </div>
          <p className="mt-2 text-xs text-white/50">No data</p>
        </>
      )}
    </div>
  );
}
