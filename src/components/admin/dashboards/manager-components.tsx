import { formatCurrency } from './shared';

export interface RepPerformance {
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

export type SortKey = 'rank' | 'repName' | 'mtdClosed' | 'mtdRevenue' | 'mtdOpens' | 'priorMonthRevenue' | 'purchase' | 'refinance' | 'escrow' | 'tsg';
export type SortDir = 'asc' | 'desc';

const RANK_COLORS = ['', 'bg-[#C5A55A]/20 text-[#8B6914]', 'bg-gray-200/60 text-gray-700', 'bg-amber-700/15 text-amber-800'];

export function RepRow({ rep, rank }: { rep: RepPerformance; rank: number | null }) {
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

export function SortTh({
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
