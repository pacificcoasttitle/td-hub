'use client';

/* ── Types ─────────────────────────────────────────────────────────────────── */

export interface DocRow {
  id: number;
  orderId: number;
  orderFileNumber: string;
  category: string;
  filename: string;
  originalFilename: string | null;
  contentType: string;
  sizeBytes: number;
  status: string;
  description: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface DocsResponse {
  documents: DocRow[];
  total: number;
  page: number;
  limit: number;
}

export const PAGE_LIMIT = 50;

/* ── Category badges ───────────────────────────────────────────────────────── */

const CAT_BADGE: Record<string, [string, string]> = {
  legal_vesting:    ['Legal Vesting',    'bg-blue-100 text-blue-700'],
  tax:              ['Tax',              'bg-green-100 text-green-700'],
  grant_deed:       ['Grant Deed',       'bg-amber-100 text-amber-700'],
  proposed_insured: ['Proposed Insured', 'bg-teal-100 text-teal-700'],
  cpl:              ['CPL',              'bg-purple-100 text-purple-700'],
};

/* ── Table ─────────────────────────────────────────────────────────────────── */

export function DocumentsTable({
  data, loading, error, emptyLabel, currentPage, onPageChange,
}: {
  data: DocsResponse | null;
  loading: boolean;
  error: string | null;
  emptyLabel: string;
  currentPage: number;
  onPageChange: (page: number) => void;
}) {
  const totalPages = data ? Math.ceil(data.total / PAGE_LIMIT) : 0;

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
      {error ? (
        <div className="p-12 text-center">
          <p className="text-red-600 font-medium">Failed to load documents.</p>
          <p className="text-sm text-[#6B7280] mt-1">Check your connection and try again.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50/60">
                <TH>Order No.</TH>
                <TH>Category</TH>
                <TH>Filename</TH>
                <TH className="text-right">Size</TH>
                <TH className="text-right">Created</TH>
                <TH className="text-center w-20">Actions</TH>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading
                ? Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)
                : data && data.documents.length > 0
                  ? data.documents.map(doc => <DocTableRow key={doc.id} doc={doc} />)
                  : null}
            </tbody>
          </table>
          {!loading && data && data.documents.length === 0 && (
            <div className="p-12 text-center">
              <p className="text-[#1A1A2E] font-medium">{emptyLabel}</p>
              <p className="text-sm text-[#6B7280] mt-1">Try adjusting your filters or date range.</p>
            </div>
          )}
        </div>
      )}

      {!loading && !error && data && data.total > PAGE_LIMIT && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50/40">
          <p className="text-sm text-[#6B7280]">
            Showing{' '}
            <span className="font-medium text-[#1A1A2E]">{(currentPage - 1) * PAGE_LIMIT + 1}</span>–
            <span className="font-medium text-[#1A1A2E]">{Math.min(currentPage * PAGE_LIMIT, data.total)}</span>{' '}
            of <span className="font-medium text-[#1A1A2E]">{data.total.toLocaleString()}</span> documents
          </p>
          <div className="flex items-center gap-2">
            <PagBtn disabled={currentPage <= 1} onClick={() => onPageChange(currentPage - 1)}>← Previous</PagBtn>
            <PagBtn disabled={currentPage >= totalPages} onClick={() => onPageChange(currentPage + 1)}>Next →</PagBtn>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Row ───────────────────────────────────────────────────────────────────── */

function DocTableRow({ doc }: { doc: DocRow }) {
  const [badge, cls] = CAT_BADGE[doc.category] ?? [doc.category.replace(/_/g, ' '), 'bg-gray-100 text-gray-600'];
  const displayName = doc.originalFilename || doc.filename;
  const truncName = displayName.length > 40 ? displayName.slice(0, 40) + '…' : displayName;

  return (
    <tr className="hover:bg-gray-50 transition-colors">
      <td className="px-4 py-3 font-mono font-medium text-[#1B2A4A] whitespace-nowrap">{doc.orderFileNumber}</td>
      <td className="px-4 py-3 whitespace-nowrap">
        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium capitalize ${cls}`}>{badge}</span>
      </td>
      <td className="px-4 py-3 text-[#1A1A2E] whitespace-nowrap" title={displayName}>{truncName}</td>
      <td className="px-4 py-3 text-[#6B7280] whitespace-nowrap text-right tabular-nums">{formatFileSize(doc.sizeBytes)}</td>
      <td className="px-4 py-3 text-[#6B7280] whitespace-nowrap text-right">
        <span title={fmtAbsolute(doc.createdAt)}>{fmtRelative(doc.createdAt)}</span>
      </td>
      <td className="px-4 py-3 text-center">
        <button onClick={() => window.open(`/api/documents/${doc.id}/download`, '_blank')}
          className="inline-flex items-center gap-1 text-xs font-medium text-[#1B2A4A] hover:text-[#243658] hover:underline transition-colors">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Download
        </button>
      </td>
    </tr>
  );
}

/* ── Sub-components ────────────────────────────────────────────────────────── */

function TH({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`text-left px-4 py-3 font-medium text-[#6B7280] whitespace-nowrap ${className}`}>{children}</th>;
}

function SkeletonRow() {
  const widths = ['w-20', 'w-20', 'w-32', 'w-14', 'w-20', 'w-16'];
  return (
    <tr>
      {widths.map((w, i) => (
        <td key={i} className="px-4 py-3">
          <div className={`h-4 bg-gray-200 rounded animate-pulse ${w} ${i >= 3 ? 'ml-auto' : ''}`} />
        </td>
      ))}
    </tr>
  );
}

function PagBtn({ children, disabled, onClick }: { children: React.ReactNode; disabled?: boolean; onClick: () => void }) {
  return (
    <button disabled={disabled} onClick={onClick}
      className={`px-4 py-1.5 text-sm font-medium rounded-md border transition-colors ${
        disabled ? 'text-gray-300 border-gray-200 cursor-not-allowed bg-white' : 'text-[#1A1A2E] border-gray-200 hover:bg-gray-100 bg-white'
      }`}>
      {children}
    </button>
  );
}

/* ── Helpers ────────────────────────────────────────────────────────────────── */

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtRelative(iso: string): string {
  try {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return iso; }
}

function fmtAbsolute(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  } catch { return iso; }
}
