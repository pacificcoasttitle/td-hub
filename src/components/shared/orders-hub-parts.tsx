import React from 'react';

export const STATUS_OPTS = ['', 'open', 'in_process', 'closed', 'cancelled'];
export const STATUS_LABELS: Record<string, string> = { open: 'Open', in_process: 'In Process', closed: 'Closed', cancelled: 'Cancelled' };
export const STATUS_COLORS: Record<string, string> = {
  open: 'bg-blue-50 text-blue-700 border-blue-200',
  in_process: 'bg-amber-50 text-amber-700 border-amber-200',
  closed: 'bg-green-50 text-green-700 border-green-200',
  cancelled: 'bg-gray-100 text-gray-500 border-gray-200',
};

export function TH({ children, center }: { children: React.ReactNode; center?: boolean }) {
  return <th className={`${center ? 'text-center' : 'text-left'} px-4 py-3 font-semibold text-[#6B7280] uppercase tracking-wide text-xs`}>{children}</th>;
}

export function StatusBadge({ status }: { status: string | null }) {
  const s = status?.toLowerCase() ?? '';
  const color = STATUS_COLORS[s] ?? 'bg-gray-100 text-gray-500 border-gray-200';
  const label = STATUS_LABELS[s] ?? status ?? '—';
  return <span className={`inline-flex px-2.5 py-1 rounded-full text-[11px] font-medium border whitespace-nowrap ${color}`}>{label}</span>;
}

export function ActionBtn({ icon, title, onClick }: { icon: string; title: string; onClick: () => void }) {
  return (
    <button onClick={onClick} title={title} className="w-8 h-8 rounded-md flex items-center justify-center text-[#6B7280] hover:bg-[#F26B2B]/10 hover:text-[#F26B2B] transition-colors">
      {icon === 'cpl' && <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>}
      {icon === 'prelim' && <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>}
      {icon === 'proposed' && <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>}
      {icon === 'notes' && <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" /></svg>}
      {icon === 'detail' && <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>}
    </button>
  );
}
