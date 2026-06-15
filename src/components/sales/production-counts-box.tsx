'use client';

import type { SalesDashboardStats } from './types';

interface Props {
  openings: SalesDashboardStats['openings'];
  closings: SalesDashboardStats['closings'];
}

type Line = { label: string; value: number };

/**
 * Build the lines for the OPENED hero.
 * MR provides byType.{purchase,refinance,other} that already reconciles to total —
 * we render Purchase + Refinance always, plus Other when > 0.
 */
function openingsLines(o: NonNullable<SalesDashboardStats['openings']>): Line[] {
  const purchase = o.byType?.purchase ?? 0;
  const refinance = o.byType?.refinance ?? 0;
  const other = o.byType?.other ?? 0;
  const lines: Line[] = [
    { label: 'Purchase', value: purchase },
    { label: 'Refinance', value: refinance },
  ];
  if (other > 0) lines.push({ label: 'Other', value: other });
  return lines;
}

/**
 * Build the lines for the CLOSED hero.
 * Purchase + Refinance always, TSG only when count > 0; Escrow folds into Other
 * (deferred from explicit display). Other is computed locally as the remainder
 * so visible lines === closings.total. This is the only locally-computed value.
 */
function closingsLines(c: NonNullable<SalesDashboardStats['closings']>): Line[] {
  const purchaseCount = c.byType?.purchase?.count ?? 0;
  const refinanceCount = c.byType?.refinance?.count ?? 0;
  const tsgCount = c.byType?.tsg?.count ?? 0;
  const showTsg = tsgCount > 0;

  const lines: Line[] = [
    { label: 'Purchase', value: purchaseCount },
    { label: 'Refinance', value: refinanceCount },
  ];
  if (showTsg) lines.push({ label: 'TSG', value: tsgCount });

  const shown = purchaseCount + refinanceCount + (showTsg ? tsgCount : 0);
  const other = Math.max(0, c.total - shown);
  if (other > 0) lines.push({ label: 'Other', value: other });

  return lines;
}

export function ProductionCountsBox({ openings, closings }: Props) {
  const hasData = openings !== null || closings !== null;

  if (!hasData) {
    return (
      <div className="bg-[#1B2A4A] rounded-xl p-6 flex flex-col items-center justify-center text-center min-h-[200px]">
        <p className="text-xs text-white/60 uppercase tracking-wider">THIS MONTH</p>
        <p className="text-[42px] font-semibold text-white/30 leading-none mt-3">—</p>
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

  return (
    <div className="bg-[#1B2A4A] rounded-xl p-6">
      <p className="text-xs text-white/60 uppercase tracking-wider">THIS MONTH</p>

      <div className="grid grid-cols-2 gap-6 mt-2">
        <Hero label="OPENED" total={openTotal} lines={openLines} hasData={openings !== null} />
        <Hero label="CLOSED" total={closedTotal} lines={closedLines} hasData={closings !== null} />
      </div>

      {(openMismatch || closedMismatch) && (
        <p
          className="mt-4 pt-3 border-t border-white/10 text-[11px] text-amber-300"
          role="status"
        >
          {openMismatch && (
            <span>Openings by type ({openSum}) does not sum to total ({openTotal}). </span>
          )}
          {closedMismatch && (
            <span>Closings by type ({closedSum}) does not sum to total ({closedTotal}). </span>
          )}
        </p>
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
      <p className="text-[11px] text-white/60 uppercase tracking-wider">{label}</p>
      {hasData ? (
        <>
          <p className="text-[42px] font-semibold text-[#F26B2B] leading-none mt-1 tabular-nums">
            {total.toLocaleString()}
          </p>
          <ul className="mt-3 space-y-1">
            {lines.map((line) => (
              <li
                key={line.label}
                className="flex items-baseline justify-between text-sm text-white/80"
              >
                <span className="text-white/60">{line.label}</span>
                <span className="font-medium tabular-nums">{line.value.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <p className="text-[42px] font-semibold text-white/30 leading-none mt-1">—</p>
          <p className="text-xs text-white/50 mt-2">No data</p>
        </>
      )}
    </div>
  );
}
