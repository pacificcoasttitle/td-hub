'use client';

export function SkeletonRow({ cols }: { cols: number }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 bg-gray-200 rounded animate-pulse w-3/4" />
        </td>
      ))}
    </tr>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="p-12 text-center">
      <p className="text-[#1A1A2E] font-medium">No results</p>
      <p className="text-sm text-[#6B7280] mt-1">{message}</p>
    </div>
  );
}

export function ErrorBlock({ message }: { message: string }) {
  return (
    <div className="p-8 text-center">
      <p className="text-red-600 font-medium">{message}</p>
      <p className="text-sm text-[#6B7280] mt-1">Check your connection and try again.</p>
    </div>
  );
}

export function Pagination({
  current, total, count, pageSize, onChange,
}: {
  current: number; total: number; count: number; pageSize: number; onChange: (p: number) => void;
}) {
  const pages = buildPageRange(current, total);
  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50/40">
      <p className="text-sm text-[#6B7280]">
        Showing{' '}
        <span className="font-medium text-[#1A1A2E]">{(current - 1) * pageSize + 1}</span>–
        <span className="font-medium text-[#1A1A2E]">{Math.min(current * pageSize, count)}</span>{' '}
        of <span className="font-medium text-[#1A1A2E]">{count}</span>
      </p>
      <div className="flex items-center gap-1">
        <PagBtn disabled={current <= 1} onClick={() => onChange(current - 1)}>‹ Prev</PagBtn>
        {pages.map((p, i) =>
          p === null ? (
            <span key={`e${i}`} className="px-1 text-[#6B7280]">…</span>
          ) : (
            <PagBtn key={p} active={p === current} onClick={() => onChange(p)}>{p}</PagBtn>
          ),
        )}
        <PagBtn disabled={current >= total} onClick={() => onChange(current + 1)}>Next ›</PagBtn>
      </div>
    </div>
  );
}

function PagBtn({
  children, disabled, active, onClick,
}: {
  children: React.ReactNode; disabled?: boolean; active?: boolean; onClick: () => void;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
        active
          ? 'bg-[#1B2A4A] text-white'
          : disabled
            ? 'text-gray-300 cursor-not-allowed'
            : 'text-[#1A1A2E] hover:bg-gray-100'
      }`}
    >
      {children}
    </button>
  );
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
