'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  MetricCard, MetricCardSkeleton, SectionCard, ErrorBanner,
  formatAddress, formatDate, formatCurrency, formatRelative,
} from './shared';
import { RepRow, SortTh } from './manager-components';
import type { RepPerformance, SortKey, SortDir } from './manager-components';
import { MONTH_NAMES } from './month-selector';

// ─── Types ──────────────────────────────────────────────────────────────────

interface TeamStats {
  totalOpen: number;
  totalClosedThisMonth: number;
  teamPipelineValue: number | null;
  teamRevenue: number | null;
  lastUpdated: string | null;
}

interface BranchStat {
  branchId: number;
  branchCode: string;
  branchName: string;
  openOrders: number;
  closedOrders: number;
}

interface ClosedOrder {
  id: number;
  fileNumber: string;
  salesRepName: string | null;
  closedAt: string;
  property: { address: string | null; city: string | null; state: string | null } | null;
}

// ─── Normalizer (API field names → component field names) ───────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeRep(entry: any): RepPerformance {
  return {
    repId: entry.contactId ?? entry.repId,
    repName: entry.salesRep ?? entry.repName,
    mtdClosed: entry.mtdClosed ?? 0,
    mtdRevenue: entry.mtdRevenue ?? null,
    mtdOpens: entry.mtdOpens ?? entry.opens ?? 0,
    priorMonthRevenue: entry.priorRevenue ?? entry.priorMonthRevenue ?? null,
    purchase: entry.purchaseCount ?? entry.purchase ?? 0,
    refinance: entry.refiCount ?? entry.refinance ?? 0,
    escrow: entry.escrowCount ?? entry.escrow ?? 0,
    tsg: entry.tsgCount ?? entry.tsg ?? 0,
  };
}

// ─── Component ──────────────────────────────────────────────────────────────

export function ManagerDashboard({ month: monthProp, year: yearProp }: { month?: number; year?: number }) {
  const router = useRouter();
  const month = monthProp ?? new Date().getMonth() + 1;
  const year = yearProp ?? new Date().getFullYear();
  const monthName = MONTH_NAMES[month - 1];
  const isCurrentMonth = month === new Date().getMonth() + 1 && year === new Date().getFullYear();

  const [stats, setStats] = useState<TeamStats | null>(null);
  const [reps, setReps] = useState<RepPerformance[]>([]);
  const [branches, setBranches] = useState<BranchStat[]>([]);
  const [closings, setClosings] = useState<ClosedOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('rank');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  useEffect(() => {
    setLoading(true);
    setError(null);
    const controller = new AbortController();
    const opts = { signal: controller.signal };
    const qs = `month=${month}&year=${year}`;
    Promise.all([
      fetch(`/api/dashboard/manager/team-stats?${qs}`, opts).then((r) => r.ok ? r.json() : null),
      fetch(`/api/managers-report/leaderboard?${qs}`, opts)
        .then((r) => r.ok ? r.json() : null)
        .then((d) => d ?? fetch(`/api/dashboard/manager/rep-performance?${qs}`, opts).then((r) => r.ok ? r.json() : { reps: [] })),
      fetch(`/api/dashboard/manager/branch-stats?${qs}`, opts).then((r) => r.ok ? r.json() : { branches: [] }),
      fetch(`/api/dashboard/manager/recent-closings?limit=20&${qs}`, opts).then((r) => r.ok ? r.json() : { orders: [] }),
    ])
      .then(([s, r, b, c]) => {
        setStats(s);
        setReps((r.leaderboard ?? r.reps ?? []).map(normalizeRep));
        setBranches((b.branches ?? []).sort((a: BranchStat, b: BranchStat) => (b.openOrders + b.closedOrders) - (a.openOrders + a.closedOrders)));
        setClosings(c.closings ?? c.orders ?? []);
      })
      .catch((e) => { if (e.name !== 'AbortError') setError(e.message); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [month, year]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'repName' ? 'asc' : 'desc');
    }
  }

  const sortedReps = [...reps].sort((a, b) => {
    if (sortKey === 'rank') return 0;
    const aVal = a[sortKey] ?? 0;
    const bVal = b[sortKey] ?? 0;
    if (typeof aVal === 'string' && typeof bVal === 'string') {
      return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    }
    return sortDir === 'asc' ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
  });

  /* Show empty states, not errors — B8/B9 hardening */

  return (
    <>
      {/* Row 1: Team Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <MetricCardSkeleton key={i} />)
        ) : stats ? (
          <>
            <MetricCard label={isCurrentMonth ? 'Opened This Month' : `Opened in ${monthName}`} value={stats.totalOpen.toLocaleString()} accent="bg-[#1B2A4A]" />
            <MetricCard label={isCurrentMonth ? 'Closed This Month' : `Closed in ${monthName}`} value={stats.totalClosedThisMonth.toLocaleString()} accent="bg-green-500" />
            <MetricCard
              label="Avg Per Close"
              value={
                stats.teamRevenue != null && stats.teamRevenue > 0 && stats.totalClosedThisMonth > 0
                  ? formatCurrency(stats.teamRevenue / stats.totalClosedThisMonth)
                  : '—'
              }
              sub={stats.teamRevenue == null || stats.teamRevenue === 0 ? 'Requires Managers Report data' : undefined}
              accent="bg-blue-500"
            />
            <MetricCard
              label={isCurrentMonth ? 'Team MTD Revenue' : `Revenue — ${monthName}`}
              value={stats.teamRevenue != null ? formatCurrency(stats.teamRevenue) : '—'}
              sub={stats.lastUpdated ? `Updated ${formatRelative(stats.lastUpdated)}` : 'Managers Report API'}
              accent="bg-[#C5A55A]"
            />
          </>
        ) : null}
      </div>

      {/* Row 2: Rep Performance Leaderboard */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden mb-6">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-[#1A1A2E]">Rep Performance — Leaderboard</h2>
          {stats?.lastUpdated && (
            <p className="text-xs text-[#6B7280]">Data from PCT Management Reports · {formatRelative(stats.lastUpdated)}</p>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50/60">
                <SortTh label="#" sortKey="rank" currentKey={sortKey} dir={sortDir} onSort={handleSort} className="w-12" />
                <SortTh label="Rep Name" sortKey="repName" currentKey={sortKey} dir={sortDir} onSort={handleSort} className="min-w-[160px]" />
                <SortTh label="MTD Closed" sortKey="mtdClosed" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                <SortTh label="MTD Revenue" sortKey="mtdRevenue" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                <SortTh label="MTD Opens" sortKey="mtdOpens" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                <SortTh label="Prior Mo. Rev" sortKey="priorMonthRevenue" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                <SortTh label="Purchase" sortKey="purchase" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                <SortTh label="Refi" sortKey="refinance" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                <SortTh label="Escrow" sortKey="escrow" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                <SortTh label="TSG" sortKey="tsg" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading
                ? Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i}>{Array.from({ length: 10 }).map((_, j) => (
                      <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-200 rounded animate-pulse w-3/4" /></td>
                    ))}</tr>
                  ))
                : sortedReps.map((rep, i) => {
                    const rank = sortKey === 'rank' ? i + 1 : null;
                    return <RepRow key={rep.repId} rep={rep} rank={rank} />;
                  })}
            </tbody>
          </table>
          {!loading && reps.length === 0 && (
            <div className="p-8 text-center">
              <p className="text-sm text-[#6B7280]">No rep performance data available. Managers Report API may not be connected.</p>
            </div>
          )}
        </div>
      </div>

      {/* Row 3: Branches + Recent Closings */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SectionCard title={`Branch Performance — ${monthName} ${year}`}>
          {loading ? (
            <div className="p-5 space-y-3 animate-pulse">
              {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-14 bg-gray-100 rounded-lg" />)}
            </div>
          ) : branches.length > 0 ? (
            <div className="p-5 space-y-3">
              {branches.map((b) => {
                const total = b.openOrders + b.closedOrders;
                const closedPct = total > 0 ? Math.round((b.closedOrders / total) * 100) : 0;
                return (
                  <div key={b.branchId} className="bg-gray-50 rounded-lg border border-gray-100 p-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-[#1B2A4A] bg-[#1B2A4A]/10 px-2 py-0.5 rounded">{b.branchCode}</span>
                        <span className="text-sm font-medium text-[#1A1A2E]">{b.branchName}</span>
                      </div>
                      <span className="text-xs text-[#6B7280]">{total} total</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden flex">
                      <div className="h-full bg-green-500 transition-all" style={{ width: `${closedPct}%` }} />
                      <div className="h-full bg-blue-400 transition-all" style={{ width: `${100 - closedPct}%` }} />
                    </div>
                    <div className="flex items-center gap-4 mt-1.5 text-xs text-[#6B7280]">
                      <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-green-500" />{b.closedOrders} closed</span>
                      <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-blue-400" />{b.openOrders} open</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="p-8 text-center"><p className="text-sm text-[#6B7280]">No branch data available.</p></div>
          )}
        </SectionCard>

        <SectionCard title={`Closings — ${monthName} ${year}`}>
          {loading ? (
            <div className="divide-y divide-gray-100">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="px-5 py-3 animate-pulse"><div className="h-4 bg-gray-200 rounded w-3/4 mb-1" /><div className="h-3 bg-gray-200 rounded w-1/2" /></div>
              ))}
            </div>
          ) : closings.length > 0 ? (
            <div className="overflow-y-auto max-h-[420px]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white">
                  <tr className="border-b border-gray-100 bg-gray-50/60">
                    <th className="text-left px-5 py-2.5 font-medium text-[#6B7280]">File #</th>
                    <th className="text-left px-5 py-2.5 font-medium text-[#6B7280]">Address</th>
                    <th className="text-left px-5 py-2.5 font-medium text-[#6B7280]">Sales Rep</th>
                    <th className="text-left px-5 py-2.5 font-medium text-[#6B7280]">Closed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {closings.map((o) => (
                    <tr key={o.id} onClick={() => router.push(`/orders/${o.id}`)} className="hover:bg-gray-50 cursor-pointer transition-colors">
                      <td className="px-5 py-2.5 font-medium text-[#1B2A4A] whitespace-nowrap">{o.fileNumber}</td>
                      <td className="px-5 py-2.5 text-[#1A1A2E] max-w-[200px] truncate">{formatAddress(o.property)}</td>
                      <td className="px-5 py-2.5 text-[#6B7280] whitespace-nowrap">{o.salesRepName ?? '—'}</td>
                      <td className="px-5 py-2.5 text-[#6B7280] whitespace-nowrap">{formatDate(o.closedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-8 text-center"><p className="text-sm text-[#6B7280]">No closed orders for {monthName} {year}.</p></div>
          )}
        </SectionCard>
      </div>
    </>
  );
}
