'use client';

interface ModalShellProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  wide?: boolean;
  children: React.ReactNode;
}

export function ModalShell({ open, onClose, title, subtitle, wide, children }: ModalShellProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] px-4">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className={`relative bg-white rounded-xl shadow-2xl overflow-hidden ${wide ? 'w-full max-w-4xl' : 'w-full max-w-lg'} max-h-[80vh] flex flex-col`}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 shrink-0 bg-[#1B2A4A]">
          <div>
            <h3 className="text-sm font-semibold text-white">{title}</h3>
            {subtitle && <p className="text-xs text-white/50 mt-0.5 font-mono">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white p-1 -mr-1">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
