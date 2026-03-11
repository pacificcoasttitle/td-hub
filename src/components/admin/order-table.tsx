'use client';

interface OrderProperty {
  address: string | null;
  city: string | null;
  state: string | null;
  county: string | null;
  fullAddress: string | null;
}

export interface Order {
  id: number;
  fileNumber: string;
  operationalStatus: string;
  transactionType: string | null;
  salesRepId: number | null;
  salesRepName?: string | null;
  openedAt: string;
  property: OrderProperty | null;
}

export interface OrderListResponse {
  orders: Order[];
  total: number;
  page: number;
  pageSize: number;
}

export const PAGE_SIZE = 25;

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-blue-100 text-blue-800',
  in_process: 'bg-amber-100 text-amber-800',
  completed: 'bg-green-100 text-green-800',
  closed: 'bg-slate-100 text-slate-800',
  canceled: 'bg-red-100 text-red-800',
  duplicate: 'bg-gray-100 text-gray-600',
};

export function OrderTable({
  orders, loading, error, currentPage, totalPages, total, onPageChange, onRowClick,
}: {
  orders: Order[] | undefined;
  loading: boolean;
  error: string | null;
  currentPage: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
  onRowClick: (orderId: number) => void;
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
      {error ? (
        <div className="p-8 text-center">
          <p className="text-red-600 font-medium">{error}</p>
          <p className="text-sm text-[#6B7280] mt-1">Check your connection and try again.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50/60">
                <th className="text-left px-4 py-3 font-medium text-[#6B7280] whitespace-nowrap">File #</th>
                <th className="text-left px-4 py-3 font-medium text-[#6B7280] whitespace-nowrap">Address</th>
                <th className="text-left px-4 py-3 font-medium text-[#6B7280] whitespace-nowrap">Status</th>
                <th className="text-left px-4 py-3 font-medium text-[#6B7280] whitespace-nowrap">Type</th>
                <th className="text-left px-4 py-3 font-medium text-[#6B7280] whitespace-nowrap">Sales Rep</th>
                <th className="text-left px-4 py-3 font-medium text-[#6B7280] whitespace-nowrap">Opened</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading
                ? Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)
                : orders && orders.length > 0
                  ? orders.map((order) => (
                      <tr key={order.id} onClick={() => onRowClick(order.id)}
                        className="hover:bg-gray-50 cursor-pointer transition-colors">
                        <td className="px-4 py-3 font-medium text-[#1B2A4A] whitespace-nowrap">{order.fileNumber}</td>
                        <td className="px-4 py-3 text-[#1A1A2E] max-w-xs truncate">{formatAddress(order.property)}</td>
                        <td className="px-4 py-3 whitespace-nowrap"><StatusBadge status={order.operationalStatus} /></td>
                        <td className="px-4 py-3 text-[#1A1A2E] whitespace-nowrap">{order.transactionType ?? '—'}</td>
                        <td className="px-4 py-3 text-[#1A1A2E] whitespace-nowrap">{order.salesRepName ?? '—'}</td>
                        <td className="px-4 py-3 text-[#6B7280] whitespace-nowrap">{formatDate(order.openedAt)}</td>
                      </tr>
                    ))
                  : null}
            </tbody>
          </table>
          {!loading && orders && orders.length === 0 && (
            <div className="p-12 text-center">
              <p className="text-[#1A1A2E] font-medium">No orders found</p>
              <p className="text-sm text-[#6B7280] mt-1">Try adjusting your search or filters.</p>
            </div>
          )}
        </div>
      )}
      {!loading && !error && totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50/40">
          <p className="text-sm text-[#6B7280]">
            Showing{' '}
            <span className="font-medium text-[#1A1A2E]">{(currentPage - 1) * PAGE_SIZE + 1}</span>–
            <span className="font-medium text-[#1A1A2E]">{Math.min(currentPage * PAGE_SIZE, total)}</span>{' '}
            of <span className="font-medium text-[#1A1A2E]">{total}</span>
          </p>
          <div className="flex items-center gap-1">
            <PagBtn disabled={currentPage <= 1} onClick={() => onPageChange(currentPage - 1)}>‹ Prev</PagBtn>
            {buildPageRange(currentPage, totalPages).map((p, i) =>
              p === null ? (
                <span key={`e${i}`} className="px-1 text-[#6B7280]">…</span>
              ) : (
                <PagBtn key={p} active={p === currentPage} onClick={() => onPageChange(p)}>{p}</PagBtn>
              ),
            )}
            <PagBtn disabled={currentPage >= totalPages} onClick={() => onPageChange(currentPage + 1)}>Next ›</PagBtn>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? 'bg-gray-100 text-gray-600';
  return <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${color}`}>{status.replace(/_/g, ' ')}</span>;
}

function SkeletonRow() {
  return (
    <tr>
      {Array.from({ length: 6 }).map((_, i) => (
        <td key={i} className="px-4 py-3"><div className="h-4 bg-gray-200 rounded animate-pulse w-3/4" /></td>
      ))}
    </tr>
  );
}

function PagBtn({ children, disabled, active, onClick }: {
  children: React.ReactNode; disabled?: boolean; active?: boolean; onClick: () => void;
}) {
  return (
    <button disabled={disabled} onClick={onClick}
      className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
        active ? 'bg-[#1B2A4A] text-white' : disabled ? 'text-gray-300 cursor-not-allowed' : 'text-[#1A1A2E] hover:bg-gray-100'
      }`}>
      {children}
    </button>
  );
}

function formatAddress(property: OrderProperty | null): string {
  if (!property) return '—';
  const parts = [property.address, property.city, property.state].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : '—';
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return '—'; }
}

function buildPageRange(current: number, total: number): (number | null)[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | null)[] = [1];
  if (current > 3) pages.push(null);
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  for (let i = start; i <= end; i++) pages.push(i);
  if (current < total - 2) pages.push(null);
  pages.push(total);
  return pages;
}
