'use client';

import type { SalesDashboardStats } from './types';

interface Props {
  openings: SalesDashboardStats['openings'];
  closings: SalesDashboardStats['closings'];
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

export function ProductionCountsBox({ openings, closings }: Props) {
  const hasData = openings !== null || closings !== null;

  if (!hasData) {
    return (
      <div className="bg-[#1B2A4A] rounded-xl p-6 flex flex-col items-center justify-center text-center min-h-[200px]">
        <p className="text-[42px] font-semibold text-white/30 leading-none">—</p>
        <p className="text-sm text-white/50 mt-1">Production data unavailable</p>
      </div>
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

  return (
    <div className="bg-[#1B2A4A] rounded-xl p-6">
      <div className="grid grid-cols-2 gap-6">
        <Hero label="OPENED" total={openTotal} lines={openLines} hasData={openings !== null} />
        <Hero label="CLOSED" total={closedTotal} lines={closedLines} hasData={closings !== null} />
      </div>

      {(showProjected || openMismatch || closedMismatch) && (
        <div className="mt-3 pt-3 border-t border-white/10 space-y-1">
          {showProjected && (
            <p className="text-sm text-white/50">
              {projectedOpens !== null && (
                <>
                  Proj. opened:{' '}
                  <span className="text-sm font-semibold text-[#F26B2B]">
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
                  <span className="text-sm font-semibold text-[#F26B2B]">
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
    </div>
  );
}

function Hero({
  label,
  total,
  lines,
  hasData,
}: {
  label: string;
  total: number;
  lines: Line[];
  hasData: boolean;
}) {
  return (
    <div>
      <p className="text-xs text-white/60 uppercase tracking-wider">{label}</p>
      {hasData ? (
        <>
          <p className="text-[42px] font-semibold text-[#F26B2B] leading-tight mt-1 tabular-nums">
            {total.toLocaleString()}
          </p>
          {lines.length > 0 && (
            <div className="flex gap-6 mt-3 flex-wrap">
              {lines.map((line) => (
                <div key={line.label}>
                  <p className="text-xs text-white/50">{line.label}</p>
                  <p className="text-base text-white font-medium tabular-nums">
                    {line.value.toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <p className="text-[42px] font-semibold text-white/30 leading-tight mt-1">—</p>
          <p className="text-xs text-white/50 mt-2">No data</p>
        </>
      )}
    </div>
  );
}
