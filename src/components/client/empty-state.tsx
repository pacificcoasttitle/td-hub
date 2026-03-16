'use client';

import Link from 'next/link';

type EmptyType = 'no-files' | 'no-documents' | 'no-cpl' | 'no-prelim' | 'no-fees' | 'no-notes';

const CONFIG: Record<EmptyType, { icon: string; title: string; description: string; action?: { label: string; href: string } }> = {
  'no-files': {
    icon: 'M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z',
    title: 'No files yet',
    description: 'Your first order is just a click away',
    action: { label: 'Open New Order', href: '/client/orders/new' },
  },
  'no-documents': {
    icon: 'M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12',
    title: 'No documents yet',
    description: 'Upload documents to get started with this file',
  },
  'no-cpl': {
    icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
    title: 'No CPL generated',
    description: 'Generate your Closing Protection Letter when ready',
  },
  'no-prelim': {
    icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
    title: 'No prelim report',
    description: 'The preliminary report will appear here once received',
  },
  'no-fees': {
    icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
    title: 'No fee estimate yet',
    description: 'Fees will appear here once your order has been processed',
  },
  'no-notes': {
    icon: 'M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z',
    title: 'No notes yet',
    description: 'Notes from your team will appear here',
  },
};

interface EmptyStateProps {
  type: EmptyType;
  action?: { label: string; onClick: () => void };
}

export function EmptyState({ type, action }: EmptyStateProps) {
  const c = CONFIG[type];
  return (
    <div className="flex flex-col items-center justify-center py-16 px-8 text-center">
      <div className="mb-6 p-4 rounded-full bg-[#F3F4F6]">
        <svg className="h-8 w-8 text-[#4B5563]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={c.icon} />
        </svg>
      </div>
      <h3 className="text-lg font-semibold text-[#1B2A4A] mb-2">{c.title}</h3>
      <p className="text-sm text-[#4B5563] max-w-sm mb-6">{c.description}</p>
      {c.action && (
        <Link href={c.action.href} className="px-5 py-2.5 text-sm font-medium bg-[#F26B2B] text-white rounded-lg hover:bg-[#E05A1A] transition-colors">
          {c.action.label}
        </Link>
      )}
      {action && (
        <button onClick={action.onClick} className="px-5 py-2.5 text-sm font-medium bg-[#F26B2B] text-white rounded-lg hover:bg-[#E05A1A] transition-colors">
          {action.label}
        </button>
      )}
    </div>
  );
}
