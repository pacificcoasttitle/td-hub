'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  MetricCard, MetricCardSkeleton, SectionCard, ErrorBanner,
  formatAddress, formatDate, formatCurrency, formatRelative,
} from './shared';

// ─── Types ──────────────────────────────────────────────────────────────────

interface TeamStats {
  totalOpen: number;
  totalClosedThisMonth: number;
  teamPipelineValue: number | null;
  teamRevenue: number | null;
  lastUpdated: string | null;
}

interface RepPerformance {
  repId: number;
  repName: string;
  mtdClosed: number;
  mtdRevenue: number | null;
  mtdOpens: number;
  priorMonthRevenue: number | null;
  purchase: number;
  refinance: number;
  escrow: number;
  tsg: number;
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

type SortKey = 'rank' | 'repName' | 'mtdClosed' | 'mtdRevenue' | 'mtdOpens' | 'priorMonthRevenue' | 'purchase' | 'refinance' | 'escrow' | 'tsg';
type SortDir = 'asc' | 'desc';

const RANK_COLORS = ['', 'bg-[#C5A55A]/20 text-[#8B6914]', 'bg-gray-200/60 text-gray-700', 'bg-amber-700/15 text-amber-800'];

// ─── Component ──────────────────────────────────────────────────────────────

export function ManagerDashboard() {
  const router = useRouter();
  const [stats, setStats] = useState<TeamStats | null>(null);
  const [reps, setReps] = useState<RepPerformance[]>([]);
  const [branches, setBranches] = useState<BranchStat[]>([]);
  const [closings, setClosings] = useState<ClosedOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('rank');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  useEffect(() => {
    const controller = new AbortController();
    const opts = { signal: controller.signal };
    Promise.all([
      fetch('/api/dashboard/manager/team-stats', opts).then((r) => r.ok ? r.json() : null),
      fetch('/api/dashboard/manager/rep-performance', opts).then((r) => r.ok ? r.json() : { reps: [] }),
      fetch('/api/dashboard/manager/branch-stats', opts).then((r) => r.ok ? r.json() : { branches: [] }),
      fetch('/api/dashboard/manager/recent-closings?limit=20', opts).then((r) => r.ok ? r.json() : { orders: [] }),
    ])
      .then(([s, r, b, c]) => {
        setStats(s);
        setReps(r.reps ?? []);
        setBranches((b.branches ?? []).sort((a: BranchStat, b: BranchStat) => (b.openOrders + b.closedOrders) - (a.openOrders + a.closedOrders)));
        setClosings(c.orders ?? []);
      })
      .catch((e) => { if (e.name !== 'AbortError') setError(e.message); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

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

  if (error) return <ErrorBanner message={error} />;

  return (
    <>
      {/* Row 1: Team Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <MetricCardSkeleton key={i} />)
        ) : stats ? (
          <>
            <MetricCard label="Total Open Orders" value={stats.totalOpen.toLocaleString()} accent="bg-[#1B2A4A]" />
            <MetricCard label="Closed This Month" value={stats.totalClosedThisMonth.toLocaleString()} accent="bg-green-500" />
            <MetricCard
              label="Team Pipeline Value"
              value={stats.teamPipelineValue != null ? formatCurrency(stats.teamPipelineValue) : '—'}
              accent="bg-blue-500"
            />
            <MetricCard
              label="Team MTD Revenue"
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
        {/* Left: Branch Performance */}
        <SectionCard title="Branch Performance">
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

        {/* Right: Recent Closings */}
        <SectionCard title="Recent Closings">
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
            <div className="p-8 text-center"><p className="text-sm text-[#6B7280]">No closed orders this month.</p></div>
          )}
        </SectionCard>
      </div>
    </>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function RepRow({ rep, rank }: { rep: RepPerformance; rank: number | null }) {
  const rankBg = rank && rank <= 3 ? RANK_COLORS[rank] : '';
  return (
    <tr className="hover:bg-gray-50 transition-colors">
      <td className="px-4 py-3 text-center">
        {rank ? (
          <span className={`inline-flex items-center justify-center h-6 w-6 rounded-full text-xs font-bold ${rankBg || 'text-[#6B7280]'}`}>
            {rank}
          </span>
        ) : <span className="text-[#6B7280]">—</span>}
      </td>
      <td className="px-4 py-3 font-medium text-[#1B2A4A] whitespace-nowrap">{rep.repName}</td>
      <td className="px-4 py-3 text-[#1A1A2E] text-center font-semibold">{rep.mtdClosed}</td>
      <td className="px-4 py-3 text-[#1A1A2E] whitespace-nowrap font-semibold">
        {rep.mtdRevenue != null ? formatCurrency(rep.mtdRevenue) : '—'}
      </td>
      <td className="px-4 py-3 text-[#6B7280] text-center">{rep.mtdOpens}</td>
      <td className="px-4 py-3 text-[#6B7280] whitespace-nowrap">
        {rep.priorMonthRevenue != null ? formatCurrency(rep.priorMonthRevenue) : '—'}
      </td>
      <td className="px-4 py-3 text-[#6B7280] text-center">{rep.purchase}</td>
      <td className="px-4 py-3 text-[#6B7280] text-center">{rep.refinance}</td>
      <td className="px-4 py-3 text-[#6B7280] text-center">{rep.escrow}</td>
      <td className="px-4 py-3 text-[#6B7280] text-center">{rep.tsg}</td>
    </tr>
  );
}

function SortTh({
  label, sortKey, currentKey, dir, onSort, className,
}: {
  label: string; sortKey: SortKey; currentKey: SortKey; dir: SortDir; onSort: (k: SortKey) => void; className?: string;
}) {
  const active = currentKey === sortKey;
  return (
    <th className={`text-left px-4 py-3 font-medium text-[#6B7280] ${className ?? ''}`}>
      <button onClick={() => onSort(sortKey)} className="inline-flex items-center gap-1 hover:text-[#1A1A2E] transition-colors">
        {label}
        {active && (
          <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={dir === 'asc' ? 'M5 15l7-7 7 7' : 'M19 9l-7 7-7-7'} />
          </svg>
        )}
      </button>
    </th>
  );
}
